/* =====================================================================
   MUGEN world: the per-tick simulation shared by both fighters (hit
   resolution, projectiles, explods, helpers, pushing, camera, sound hooks
   and the CPU opponent). Drawing lives in draw.js, state controllers in
   controllers.js.

   Key concepts:
   - Player / fighter: the two main characters (P1, P2), each with an
     `opponent`. Helpers are extra sub-characters spawned by a fighter.
   - Explod: a purely visual animation spawned by an Explod controller (also
     used for hit sparks). It is not a character and never hits anything.
   - Projectile: a flying attack with its own HitDef, owned by a fighter.
   - HitDef: the description of an attack (damage, pause, velocities, ...).
   - Pause / SuperPause: freeze the world for a number of ticks; only the
     fighters that were granted "movetime" keep updating.
   - Bind: a fighter / helper glued to another entity at a relative offset.
   - Coordinates: fighters use `posX/posY` in their own character space (y is
     negative upwards) and `x` in world pixels; the character scale `s`
     converts between them.
   ===================================================================== */

/** Round information exposed to the RoundState / RoundNo / MatchOver triggers. */
const MGR = {
  /** @returns {number} 1 = pre-fight intro, 2 = fighting, 3 = KO / round end. */
  roundState() {
    return G.phase === 'fight' ? 2 : G.phase === 'ko' || G.phase === 'end' ? 3 : 1;
  },
  /** @returns {number} Current round number (1 when no match is running). */
  roundNo() {
    return (typeof window !== 'undefined' && window.IK && IK.Match && IK.Match.round) || 1;
  },
  /** @returns {number} 1 when the whole match has finished, otherwise 0. */
  matchOver() {
    return G.phase === 'end' ? 1 : 0;
  }
};

/** A live projectile created by the Projectile controller. */
class MProj {
  /**
   * @param {object} owner Fighter (or helper) that fired the projectile.
   * @param {number} id The projectile id (`projid`), used by the ProjHit/ProjContact triggers.
   * @param {object} animation MAnim instance playing the projectile animation.
   */
  constructor(owner, id, animation) {
    this.owner = owner;
    this.id = id;
    this.animation = animation;
    this.dead = false; // scheduled for removal at the end of this tick
    this.done = false; // has used up its hits
    this.time = 0;
    this.state = 'fly'; // 'fly' | 'hit' (playing its hit animation) | 'gone'
    this.s = owner.s; // scale inherited from the owner
  }
  /** World X position in pixels. */
  get wx() {
    return STAGE_W / 2 + this.posX * this.s;
  }
  /** World Y position in pixels relative to the ground. */
  get wy() {
    return this.posY * this.s;
  }
}

/** Namespace of the MUGEN world simulation (sound, explods, helpers, projectiles, collision, tick, AI). */
const Mugen = {
  /** Active Pause/SuperPause: { t: ticks left, owner, dark? } or null. */
  pause: null,

  /* ---------- sound ---------- */

  /**
   * Play a sound from a character's SND file (or a synthesized fight effect).
   * @param {object} pkg Character package that owns the sounds.
   * @param {boolean} isFightFx True for common fight-effect sounds (group 5 hit, 6 block), which are synthesized.
   * @param {number} group Sound group number.
   * @param {number} number Sound number within the group.
   * @param {object} options Playback options (vol, pan, freq, loop, channel, lowpriority).
   */
  playSnd(pkg, isFightFx, group, number, options) {
    if (!Snd.ctx || !Snd.on) return;
    if (isFightFx) {
      if (group === 5) Snd.hit(number > 0 ? 2 : 1);
      else if (group === 6) Snd.block();
      return;
    } // the common fight-effect sounds are not shipped: use the synthesizer
    const sound = pkg.snd && pkg.snd.get(group + ',' + number);
    if (!sound || !sound.data) {
      MG.warn('Missing sound ' + group + ',' + number + ' in ' + (pkg.name || '?'));
      return;
    }
    Snd.play(sound, options);
  },

  /**
   * Register a KO once when a defender's life reaches zero.
   * @param {object} defender The fighter that was defeated.
   * @param {object} killer The fighter credited with the KO (defaults to the defender itself).
   */
  ko(defender, killer) {
    if (!defender.koSent && defender.life <= 0) {
      defender.koSent = true;
      defender.getHit.fall = 1;
      if (G.onKO) G.onKO(defender, killer || defender);
    }
  },

  /* ---------- explods ---------- */

  /**
   * Spawn an explod (cosmetic animation) for a fighter.
   * @param {object} fighter Owner of the explod.
   * @param {object} options Explod parameters: anim, id, vel, accel, removetime, ontop, scale, sprpri, trans,
   *   postype (p1, p2, front, back, left, right, none), pos, facing, bindtime.
   */
  addExplod(fighter, options) {
    if (fighter.explods.length >= 24) return;
    const pkg = fighter.pkg;
    if (!pkg.air.get(options.anim)) return; // unknown animation: nothing to show
    const animation = new MAnim(pkg);
    animation.set(options.anim);
    const explod = {
      id: options.id,
      pkg,
      animation,
      velX: (options.vel || [0, 0])[0],
      velY: (options.vel || [0, 0])[1],
      ax: (options.accel || [0, 0])[0],
      ay: (options.accel || [0, 0])[1],
      removetime: options.removetime === undefined ? -2 : options.removetime,
      time: 0,
      ontop: options.ontop,
      scale: options.scale || [1, 1],
      sprpri: options.sprpri || 0,
      s: fighter.s,
      owner: fighter,
      bind: 0, // remaining ticks the explod follows its owner (-1 = forever, 0 = free)
      trans: options.trans || ''
    };
    const posType = options.postype || 'p1',
      offset = options.pos || [0, 0],
      opponent = fighter.opponent;
    let baseX = fighter.posX,
      face = fighter.face,
      baseY = 0;
    if (posType === 'p2' && opponent) {
      baseX = opponent.posX;
      face = opponent.face;
    } else if (posType === 'front' || posType === 'back' || posType === 'left' || posType === 'right') {
      // screen edges expressed in character space
      const camLeft = (G.cam.x - STAGE_W / 2) / fighter.s,
        camRight = (G.cam.x + W - STAGE_W / 2) / fighter.s;
      const atRightEdge =
        posType === 'right' || (posType === 'front' ? fighter.face > 0 : posType === 'back' ? fighter.face < 0 : false);
      baseX = atRightEdge ? camRight : camLeft;
      face = posType === 'left' || posType === 'right' ? 1 : fighter.face;
      if (posType === 'left' || posType === 'right') {
        // absolute screen-edge positions ignore the owner's facing
        explod.posX = baseX + offset[0];
        explod.face = options.facing || 1;
        explod.posY = baseY + offset[1] - 0;
        explod.fixed = true;
      }
    } else if (posType === 'none') {
      baseX = (G.cam.x + W / 2 - STAGE_W / 2) / fighter.s;
      face = 1;
    }
    if (!explod.fixed) {
      explod.posX = baseX + offset[0] * face;
      explod.posY = baseY + offset[1];
      explod.face = (options.facing || 1) * face;
    }
    if (posType === 'p1' && options.bindtime) {
      explod.bind = options.bindtime;
      explod.rel = [offset[0], offset[1]]; // offset kept relative to the owner while bound
    }
    fighter.explods.push(explod);
  },

  /**
   * Advance all explods of a fighter by one tick and drop the finished ones.
   * @param {object} fighter Owner whose explods are updated.
   */
  updateExplods(fighter) {
    for (const explod of fighter.explods) {
      if (explod.bind !== 0 && explod.owner && explod.rel) {
        // bound: follow the owner
        explod.posX = explod.owner.posX + explod.rel[0] * explod.owner.face;
        explod.posY = explod.owner.posY + explod.rel[1];
        if (explod.bind > 0) explod.bind--;
      } else {
        explod.posX += explod.velX * explod.face;
        explod.posY += explod.velY;
        explod.velX += explod.ax;
        explod.velY += explod.ay;
      }
      explod.animation.tick();
      explod.time++;
    }
    // removetime >= 0: fixed lifetime; -2: until the animation ends; -1: never (but capped at 1200 ticks)
    fighter.explods = fighter.explods.filter(
      explod =>
        !(explod.removetime >= 0
          ? explod.time >= explod.removetime
          : explod.removetime === -2
            ? explod.animation.loops > 0 || (explod.animation.total > 0 && explod.time >= explod.animation.total)
            : false) && explod.time < 1200
    );
  },

  /* ---------- helpers ---------- */

  /**
   * Spawn a helper (an extra character running its own state machine) for a fighter.
   * @param {object} fighter The entity that executed the Helper controller (player or another helper).
   * @param {object} options Helper parameters: stateno, postype, pos, facing, id, name, pausemovetime, supermovetime.
   */
  addHelper(fighter, options) {
    const root = fighter.root || fighter;
    if (root.helpers.length >= 30) return;
    const helper = new MugenHelper(fighter, options),
      posType = options.postype || 'p1',
      offset = options.pos || [0, 0],
      opponent = root.opponent;
    let baseX = fighter.posX,
      face = fighter.face;
    if (posType === 'p2' && opponent) {
      baseX = opponent.posX;
      face = opponent.face;
    } else if (posType === 'front' || posType === 'back' || posType === 'left' || posType === 'right') {
      const camLeft = (G.cam.x - STAGE_W / 2) / fighter.s,
        camRight = (G.cam.x + W - STAGE_W / 2) / fighter.s;
      const atRightEdge =
        posType === 'right' || (posType === 'front' ? fighter.face > 0 : posType === 'back' ? fighter.face < 0 : false);
      baseX = atRightEdge ? camRight : camLeft;
      face = posType === 'left' || posType === 'right' ? 1 : fighter.face;
    }
    helper.posX = baseX + offset[0] * face;
    helper.posY =
      (posType === 'p1' || posType === 'p2' ? (posType === 'p2' && opponent ? opponent.posY : fighter.posY) : 0) +
      offset[1];
    helper.face = (options.facing < 0 ? -1 : 1) * face;
    helper.opponent = opponent;
    helper.stOwner = helper.pkg;
    helper.changeState(options.stateno, helper.pkg);
    helper.ctrl = false;
    if (helper.stateno !== options.stateno) return; // the state does not exist: the helper is not spawned
    root.helpers.push(helper);
  },

  /**
   * Pause / SuperPause lets each helper of the pauser keep moving for its own pausemovetime / supermovetime.
   * @param {object} fighter The fighter that started the pause.
   * @param {boolean} isSuper True for SuperPause (uses supermovetime), false for Pause (pausemovetime).
   */
  pauseHelpers(fighter, isSuper) {
    for (const helper of (fighter.root || fighter).helpers) helper.pausedMove = isSuper ? helper.smt : helper.pmt;
  },

  /**
   * Apply a helper's BindToParent / BindToRoot: follow the bind target for the bind time.
   * @param {object} helper The helper to position.
   */
  bindHelper(helper) {
    const bind = helper.hBind;
    if (!bind) return;
    if (bind.t <= 0 || !bind.to || bind.to.dead) {
      helper.hBind = null;
      return;
    }
    const target = bind.to;
    helper.posX = target.posX + bind.x * target.face;
    helper.posY = target.posY + bind.y;
    if (bind.facing) helper.face = bind.facing > 0 ? target.face : -target.face;
    bind.t--;
  },

  /**
   * Every helper currently alive, root player A's first.
   * @param {object} fighterA First player.
   * @param {object} fighterB Second player.
   * @returns {object[]} Helpers of both players.
   */
  allHelpers(fighterA, fighterB) {
    return fighterA.helpers.length || fighterB.helpers.length ? [...fighterA.helpers, ...fighterB.helpers] : [];
  },

  /* ---------- projectiles ---------- */

  /**
   * Create a projectile from a Projectile controller.
   * @param {object} fighter The firing fighter or helper.
   * @param {object} controller The parsed Projectile controller.
   */
  addProj(fighter, controller) {
    if (fighter.projs.length >= 16) return;
    const id = fighter.n(controller, 'projid', 0, 0) | 0,
      animNo = fighter.n(controller, 'projanim', 0, 0) | 0;
    if (!fighter.pkg.air.has(animNo)) {
      MG.warn('Projectile animation ' + animNo + ' missing');
      return;
    }
    const animation = new MAnim(fighter.pkg);
    animation.set(animNo);
    const projectile = new MProj(fighter, id, animation);
    projectile.hitDef = parseHitDef(fighter, controller, false);
    // without an explicit guard.dist the projectile uses the character's default projectile guard distance
    projectile.hitDef.guardDist = fighter.has(controller, 'guard.dist')
      ? projectile.hitDef.guardDist
      : fighter.const('size.proj.attack.dist');
    projectile.face = fighter.face;
    projectile.posX = fighter.posX + fighter.n(controller, 'offset', 0, 0) * fighter.face;
    projectile.posY = fighter.posY + fighter.n(controller, 'offset', 1, 0);
    const posType = fighter.raw(controller, 'postype', 'p1').toLowerCase();
    if (posType === 'p2' && fighter.opponent) {
      projectile.posX = fighter.opponent.posX + fighter.n(controller, 'offset', 0, 0) * fighter.opponent.face;
      projectile.posY = fighter.opponent.posY + fighter.n(controller, 'offset', 1, 0);
    }
    projectile.velX = fighter.n(controller, 'velocity', 0, 0);
    projectile.velY = fighter.n(controller, 'velocity', 1, 0);
    projectile.ax = fighter.n(controller, 'accel', 0, 0);
    projectile.ay = fighter.n(controller, 'accel', 1, 0);
    projectile.mx = fighter.n(controller, 'velmul', 0, 1);
    projectile.my = fighter.n(controller, 'velmul', 1, 1);
    projectile.hits = fighter.n(controller, 'projhits', 0, 1); // hits left before it is removed
    projectile.misstime = fighter.n(controller, 'projmisstime', 0, 0); // cooldown between hits
    projectile.cool = 0;
    projectile.removetime = fighter.n(controller, 'projremovetime', 0, -1);
    projectile.remove = fighter.n(controller, 'projremove', 0, 1);
    projectile.hitAnim = fighter.n(controller, 'projhitanim', 0, -1);
    projectile.remAnim = fighter.n(controller, 'projremanim', 0, -1);
    projectile.prio = fighter.n(controller, 'projpriority', 0, 1);
    projectile.scale = [fighter.n(controller, 'projscale', 0, 1), fighter.n(controller, 'projscale', 1, 1)];
    projectile.edge = fighter.n(controller, 'projedgebound', 0, 40);
    projectile.sprpri = fighter.n(controller, 'projsprpriority', 0, 3);
    fighter.projs.push(projectile);
  },

  /**
   * Move projectiles of a fighter, expire them and drop the dead ones.
   * @param {object} fighter Owner of the projectiles.
   */
  updateProjs(fighter) {
    for (const projectile of fighter.projs) {
      projectile.time++;
      projectile.animation.tick();
      if (projectile.state === 'fly') {
        projectile.posX += projectile.velX * projectile.face;
        projectile.posY += projectile.velY;
        projectile.velX = projectile.velX * projectile.mx + projectile.ax;
        projectile.velY = projectile.velY * projectile.my + projectile.ay;
        if (projectile.cool > 0) projectile.cool--;
        // expire on timeout or when it leaves the stage / the visible area by a margin
        if (
          (projectile.removetime >= 0 && projectile.time >= projectile.removetime) ||
          projectile.wx < -160 ||
          projectile.wx > STAGE_W + 160 ||
          projectile.wx < G.cam.x - 260 ||
          projectile.wx > G.cam.x + W + 260
        ) {
          projectile.state = 'gone';
          projectile.dead = true;
        }
      } else if (projectile.state === 'hit') {
        // playing its hit animation: end when it finishes (or after a safety timeout)
        if (projectile.animation.loops > 0 || projectile.animation.animTime() >= 0 || projectile.time > projectile.endT)
          projectile.dead = true;
      }
    }
    fighter.projs = fighter.projs.filter(projectile => !projectile.dead);
  },

  /* ---------- collision ---------- */

  /**
   * World-space collision boxes of a fighter's current animation frame.
   * @param {object} fighter The fighter or helper.
   * @param {number} kind 1 = attack boxes (Clsn1), anything else = hurt boxes (Clsn2).
   * @returns {{l:number,r:number,t:number,b:number}[]} Boxes (left, right, top, bottom) relative to the ground line.
   */
  boxes(fighter, kind) {
    const frame = fighter.animation.frame();
    if (!frame) return [];
    const boxList = kind === 1 ? frame.c1 : frame.c2;
    if (!boxList || !boxList.length) return [];
    const dir = fighter.face * (frame.fh ? -1 : 1),
      scaleX = (fighter.pkg.consts['size.xscale'] ? fighter.pkg.consts['size.xscale'][0] : 1) * (frame.xs || 1),
      scaleY = (fighter.pkg.consts['size.yscale'] ? fighter.pkg.consts['size.yscale'][0] : 1) * (frame.ys || 1),
      scale = fighter.s;
    return boxList.map(box => {
      const x1 = fighter.x + dir * box[0] * scaleX * scale,
        x2 = fighter.x + dir * box[2] * scaleX * scale;
      return {
        l: Math.min(x1, x2),
        r: Math.max(x1, x2),
        t: fighter.posY * scale + box[1] * scaleY * scale,
        b: fighter.posY * scale + box[3] * scaleY * scale
      };
    });
  },

  /**
   * World-space attack boxes of a projectile's current frame.
   * @param {object} projectile The projectile.
   * @returns {{l:number,r:number,t:number,b:number}[]} Boxes, same format as {@link Mugen.boxes}.
   */
  projBoxes(projectile) {
    const frame = projectile.animation.frame();
    if (!frame || !frame.c1) return [];
    const dir = projectile.face * (frame.fh ? -1 : 1),
      scale = projectile.s,
      scaleX = projectile.scale[0] * (frame.xs || 1),
      scaleY = projectile.scale[1] * (frame.ys || 1);
    return frame.c1.map(box => {
      const x1 = projectile.wx + dir * box[0] * scaleX * scale,
        x2 = projectile.wx + dir * box[2] * scaleX * scale;
      return {
        l: Math.min(x1, x2),
        r: Math.max(x1, x2),
        t: projectile.posY * scale + box[1] * scaleY * scale,
        b: projectile.posY * scale + box[3] * scaleY * scale
      };
    });
  },

  /**
   * Find the first overlap between two sets of boxes.
   * @param {object[]} boxesA First set of boxes.
   * @param {object[]} boxesB Second set of boxes.
   * @returns {{x:number,gy:number}|null} Centre of the overlap (x in world pixels, gy relative to the ground), or null.
   */
  overlap(boxesA, boxesB) {
    for (const boxA of boxesA)
      for (const boxB of boxesB)
        if (boxA.l < boxB.r && boxA.r > boxB.l && boxA.t < boxB.b && boxA.b > boxB.t)
          return {
            x: (Math.max(boxA.l, boxB.l) + Math.min(boxA.r, boxB.r)) / 2,
            gy: (Math.max(boxA.t, boxB.t) + Math.min(boxA.b, boxB.b)) / 2
          };
    return null;
  },

  /**
   * Is the attack ignored because of an active HitBy / NotHitBy on the defender?
   * @param {object} defender The fighter being hit.
   * @param {object} hitDef The incoming attack.
   * @returns {boolean} True when the defender is currently immune to this attack.
   */
  blocked(defender, hitDef) {
    for (const hitBy of defender.hitby) {
      if (!hitBy) continue;
      const matches = matchAttr(hitBy.attr, hitDef.attr);
      if (hitBy.not ? matches : !matches) return true;
    }
    return false;
  },

  /**
   * Can this attack connect with the defender (state type, hitflag, juggle points, immunity)?
   * @param {object} attacker The attacking fighter or helper.
   * @param {object} defender The fighter being hit.
   * @param {object} hitDef The attack's HitDef.
   * @param {boolean} isProjectile True when the attack comes from a projectile (uses its own juggle cost).
   * @returns {boolean} Whether the hit is allowed.
   */
  canHit(attacker, defender, hitDef, isProjectile) {
    if (defender.life <= 0 && defender.type === 'L') return false;
    if (Mugen.blocked(defender, hitDef)) return false;
    const hitFlags = hitDef.hitflag,
      defenderType = defender.type,
      falling = defender.getHit.fall && defender.movetype === 'H';
    if (defenderType === 'S' && !hitFlags.H) return false;
    if (defenderType === 'C' && !hitFlags.L) return false;
    if (defenderType === 'A' && !hitFlags.A) return false;
    if (defenderType === 'L' && !hitFlags.D) return false;
    if (defenderType !== 'L' && falling && !hitFlags.F) return false;
    if (hitFlags.plus && defender.movetype !== 'H') return false;
    if (hitFlags.minus && defender.movetype === 'H') return false;
    // juggle: a falling defender can only take the hit while it has enough juggle points left
    if (falling && defender.juggleLeft < (isProjectile ? hitDef.airJuggle : attacker.juggleReq)) return false;
    return true;
  },

  /**
   * Is the defender able to guard this attack right now (in a guard state and the guardflag matches)?
   * @param {object} defender The fighter being hit.
   * @param {object} hitDef The attack's HitDef.
   * @returns {boolean} True when the hit would be guarded.
   */
  canGuard(defender, hitDef) {
    if (!defender.inGuardState() || defender.type === 'L') return false;
    const guardFlags = hitDef.guardflag;
    return (
      (defender.type === 'S' && guardFlags.H) ||
      (defender.type === 'C' && guardFlags.L) ||
      (defender.type === 'A' && guardFlags.A)
    );
  },

  /**
   * The attacker (or its projectile) lands a HitDef on the defender: damage, GetHitVars, pauses, effects, sounds.
   * @param {object} attacker The attacking fighter or helper.
   * @param {object} defender The fighter being hit.
   * @param {object} hitDef The attack's HitDef.
   * @param {{x:number,gy:number}} contactPoint Where the boxes overlapped (for sparks and effects).
   * @param {object|null} projectile The projectile that hit, or null for a direct attack.
   * @returns {number} 1 when the hit connected, 2 when it was guarded.
   */
  applyHit(attacker, defender, hitDef, contactPoint, projectile) {
    const hitResult = Mugen.canGuard(defender, hitDef) ? 2 : 1, // 1 = hit, 2 = guarded
      scaleRatio = attacker.s / defender.s, // converts attacker-space values to the defender's scale
      attackerFacing = projectile ? projectile.face : attacker.face,
      getHitVars = defender.getHit,
      wasHit = defender.movetype === 'H';
    let damage = hitResult === 1 ? hitDef.damage[0] : hitDef.damage[1];
    damage =
      (damage * (attacker.const('data.attack') / 100) * (attacker.atkMul || 1)) /
      ((defender.const('data.defence') / 100) * (defender.defMul || 1));
    if (getHitVars.fall && wasHit) damage *= 100 / (100 + defender.const('data.fall.defence_up'));
    damage = Math.trunc(damage);
    // a non-lethal hit can never kill: leave the defender with 1 life
    if (damage >= defender.life && ((hitResult === 1 && !hitDef.kill) || (hitResult === 2 && !hitDef.guardKill)))
      damage = Math.max(0, defender.life - 1);
    const wasFall = getHitVars.fall && wasHit;
    defender.life = Math.max(0, defender.life - damage);
    defender.dmgTaken += damage;
    Object.assign(getHitVars, {
      pending: true,
      guarded: hitResult === 2 ? 1 : 0,
      hitid: hitDef.id,
      id: hitDef.id,
      damage,
      owner: attacker,
      hitDef
    });
    getHitVars.yaccel = hitDef.yaccel * scaleRatio;
    getHitVars.groundtype = hitDef.gtype;
    getHitVars.airtype = hitDef.atype;
    // when the defender faces the same way as the attacker, high/low hit types swap sides
    if (defender.face < 0 === attackerFacing < 0) {
      if (getHitVars.groundtype === 1 || getHitVars.groundtype === 2) getHitVars.groundtype = 3 - getHitVars.groundtype;
      if (getHitVars.airtype === 1 || getHitVars.airtype === 2) getHitVars.airtype = 3 - getHitVars.airtype;
    }
    getHitVars.type = defender.type === 'A' ? getHitVars.airtype : getHitVars.groundtype;
    // velocities are pushed away from the attacker, scaled to the defender
    const scaleVelX = value => value * scaleRatio * -attackerFacing,
      scaleVelY = value => value * scaleRatio;
    if (hitResult === 2) {
      getHitVars.hitshaketime = Math.max(0, hitDef.gpause[1]);
      getHitVars.hittime = Math.max(0, hitDef.guardHit);
      getHitVars.slidetime = hitDef.guardSlide;
      getHitVars.fall = 0;
      getHitVars.guardcount++;
      if (defender.type === 'A') {
        getHitVars.ctrltime = hitDef.airGuardCtrl;
        getHitVars.xvel = scaleVelX(hitDef.airGuardVel[0]);
        getHitVars.yvel = scaleVelY(hitDef.airGuardVel[1]);
      } else {
        getHitVars.ctrltime = hitDef.guardCtrl;
        getHitVars.xvel = scaleVelX(hitDef.guardVel[0]);
        getHitVars.yvel = 0;
      }
    } else {
      getHitVars.hitshaketime = Math.max(0, hitDef.pause[1]);
      getHitVars.slidetime = hitDef.gslide;
      getHitVars['fall.xvel'] = hitDef.fallXvel === null ? 0 : scaleVelX(hitDef.fallXvel);
      getHitVars['fall.xvelset'] = hitDef.fallXvel !== null;
      getHitVars['fall.yvel'] = scaleVelY(hitDef.fallYvel);
      getHitVars['fall.recover'] = hitDef.fallRecover;
      getHitVars['fall.recovertime'] = hitDef.fallRecoverTime;
      getHitVars['fall.damage'] = hitDef.fallDamage;
      getHitVars['fall.kill'] = hitDef.fallKill;
      getHitVars.fallShakeT = hitDef.fallShakeT;
      getHitVars.fallShakeA = hitDef.fallShakeA * scaleRatio;
      getHitVars.downRecover = hitDef.downRecover;
      getHitVars.downRecoverTime =
        hitDef.downRecoverTime < 0 ? defender.const('data.liedown.time') : hitDef.downRecoverTime;
      if (defender.type === 'A') {
        getHitVars.hittime = hitDef.airHit;
        getHitVars.ctrltime = hitDef.airHit;
        getHitVars.xvel = scaleVelX(hitDef.avel[0]);
        getHitVars.yvel = scaleVelY(hitDef.avel[1]);
        getHitVars.fall = getHitVars.fall || hitDef.airFall ? 1 : 0;
      } else if (defender.type === 'L') {
        getHitVars.hittime = hitDef.downHit;
        getHitVars.ctrltime = hitDef.downHit;
        getHitVars.fall = getHitVars.fall || hitDef.fall ? 1 : 0;
        if (defender.posY >= -1) {
          getHitVars.xvel = scaleVelX(hitDef.downVel[0]);
          getHitVars.yvel = scaleVelY(hitDef.downVel[1]);
        } else {
          getHitVars.xvel = scaleVelX(hitDef.avel[0]);
          getHitVars.yvel = scaleVelY(hitDef.avel[1]);
        }
      } else {
        getHitVars.ctrltime = hitDef.ghit;
        getHitVars.xvel = scaleVelX(hitDef.gvel[0]);
        getHitVars.yvel = scaleVelY(hitDef.gvel[1]);
        getHitVars.fall = getHitVars.fall || hitDef.fall ? 1 : 0;
        // a falling defender must leave the ground: give it a tiny upward velocity
        if (getHitVars.fall && getHitVars.yvel === 0) getHitVars.yvel = -0.001;
        getHitVars.hittime = getHitVars.yvel !== 0 ? hitDef.airHit : hitDef.ghit;
      }
      getHitVars.hitcount = wasHit ? getHitVars.hitcount + 1 : 1;
    }
    getHitVars.groundanim = hitDef.animtype;
    getHitVars.airanim = hitDef.airAnimtype;
    getHitVars.fallanim = hitDef.fallAnimtype;
    getHitVars.forcestand = hitDef.forcestand;
    getHitVars.forcecrouch = hitDef.forcecrouch;
    getHitVars.p2getp1state = hitDef.p2getp1state;
    getHitVars.guardko = 0;
    // which hit animation type the defender will use (fall / air / ground, with the grounded-launch fallback)
    const calcAnim = () =>
      getHitVars.fall
        ? getHitVars.fallanim
        : defender.type === 'A'
          ? getHitVars.airanim
          : getHitVars.groundanim >= 3 && getHitVars.yvel === 0
            ? 2
            : getHitVars.groundanim;
    // a lethal hit launches the defender into a fall with extra velocity (k240 scales 240p-based constants)
    if (defender.life <= 0 && hitResult === 1) {
      getHitVars.fall = 1;
      if (defender.type === 'A') {
        if (getHitVars.xvel) getHitVars.xvel += 2.5 * defender.k240 * Math.sign(getHitVars.xvel);
        if (getHitVars.yvel <= 0) {
          getHitVars.yvel -= 2 * defender.k240;
          if (getHitVars.yvel > -3 * defender.k240) getHitVars.yvel = -3 * defender.k240;
        }
      } else if (defender.type !== 'L') {
        if (getHitVars.yvel === 0) getHitVars.xvel *= 0.66;
        if (getHitVars.xvel) getHitVars.xvel += 2.5 * defender.k240 * Math.sign(getHitVars.xvel);
        if (getHitVars.yvel <= 0) {
          getHitVars.yvel -= 2 * defender.k240;
          if (getHitVars.yvel > -3 * defender.k240) getHitVars.yvel = -3 * defender.k240;
        }
      }
    }
    getHitVars.animtype = calcAnim();
    // each hit on a falling defender consumes juggle points
    if (wasFall || getHitVars.fall) defender.juggleLeft -= projectile ? hitDef.airJuggle : attacker.juggleReq;
    /* attacker side */
    attacker.moveContact = true;
    if (hitResult === 1) attacker.moveHit = true;
    else attacker.moveGuarded = true;
    attacker.hitCount += hitDef.numhits;
    attacker.target = defender;
    if (projectile) {
      attacker.pcontact[projectile.id] = { t: attacker.tickN, kind: hitResult === 1 ? 'hit' : 'guard' };
    } else {
      hitDef.done = true;
      attacker.hitPause = Math.max(0, hitResult === 1 ? hitDef.pause[0] : hitDef.gpause[0]);
    }
    (attacker.root || attacker).addPower(hitResult === 1 ? hitDef.getpower[0] : hitDef.getpower[1]);
    defender.addPower(hitResult === 1 ? hitDef.givepower[0] : hitDef.givepower[1]);
    if (hitResult === 1) {
      defender.combo = wasHit ? defender.combo + 1 : 1;
      attacker.comboHits = defender.combo;
      attacker.comboDmg = defender.combo === 1 ? damage : attacker.comboDmg + damage;
    }
    // facing / state changes requested by the HitDef (throws): only for direct, connected hits
    if (hitResult === 1 && !projectile) {
      if (hitDef.p1getp2facing) attacker.face = hitDef.p1getp2facing > 0 ? defender.face : -defender.face;
      else if (hitDef.p1facing < 0) attacker.face = -attacker.face;
      if (hitDef.p2facing < 0) defender.face = attackerFacing;
      else if (hitDef.p2facing > 0) defender.face = -attackerFacing;
      if (hitDef.p1stateno >= 0) {
        attacker.changeState(hitDef.p1stateno, attacker.pkg);
        attacker.ctrl = false;
      }
      if (hitDef.p2stateno >= 0) {
        defender.stOwner = hitDef.p2getp1state ? attacker.pkg : defender.pkg;
        defender.changeState(hitDef.p2stateno, defender.stOwner);
        defender.movetype = 'H';
        defender.ctrl = false;
        getHitVars.pending = false;
        getHitVars.hitPause = 0;
      }
    }
    if (hitDef.shakeT > 0 && hitResult === 1)
      G.shake = Math.max(G.shake, Math.min(14, Math.abs(hitDef.shakeA) * attacker.s * 0.45));
    /* effects */
    const effectX = contactPoint.x,
      effectY = GROUND + contactPoint.gy,
      big = hitDef.pause[1] >= 10 || getHitVars.fall; // heavy hit: stronger feedback
    G.burst(
      effectX,
      effectY,
      hitResult === 2 ? '#bfe3ff' : '#fff2b0',
      hitResult === 2 ? 6 : 12 + (big ? 6 : 0),
      hitResult === 2 ? 4 : 7
    );
    G.ring(effectX, effectY, hitResult === 2 ? '#9fd4ff' : '#ffffff', hitResult === 2 ? 50 : big ? 100 : 62);
    G.shake = Math.max(G.shake, hitResult === 2 ? 2 : big ? 7 : 4);
    if (hitResult === 1 && big) G.flash = Math.max(G.flash, 0.15);
    // hit/guard sound is a "[F|S]group,number" string: F = fight-effect (common) sound, S = the character's own
    const soundSpec = hitResult === 1 ? hitDef.hitsound : hitDef.guardsound,
      soundMatch = soundSpec.match(/^\s*([FfSs])?\s*(-?\d+)\s*,\s*(-?\d+)/);
    if (soundMatch)
      Mugen.playSnd(attacker.pkg, (soundMatch[1] || 'F').toUpperCase() === 'F', +soundMatch[2], +soundMatch[3], {});
    else if (hitResult === 1) Snd.hit(big ? 2 : 1);
    else Snd.block();
    // hit spark: "S<n>" refers to an animation of the attacker's own AIR file
    const sparkSpec = hitResult === 1 ? hitDef.spark : hitDef.gspark,
      sparkMatch = sparkSpec.match(/^\s*[Ss]\s*(-?\d+)/);
    if (sparkMatch && attacker.pkg.air.has(+sparkMatch[1]))
      Mugen.addExplod(attacker, {
        anim: +sparkMatch[1],
        id: -3,
        postype: 'none',
        pos: [0, 0],
        removetime: -2,
        ontop: true,
        _at: [effectX, contactPoint.gy]
      });
    if (defender.life <= 0) Mugen.ko(defender, attacker.root || attacker);
    return hitResult;
  },

  /**
   * ReversalDef: the defender has a ReversalDef active and the incoming attack matches its attr.
   * @param {object} attacker The attacking fighter or helper.
   * @param {object} defender The fighter holding the ReversalDef.
   * @param {object} hitDef The incoming attack.
   * @returns {boolean} True when the attack was reversed (and must not hit normally).
   */
  tryReversal(attacker, defender, hitDef) {
    const reversal = defender.hitdef;
    if (!reversal || !reversal.rev || reversal.done || defender.movetype !== 'A') return false;
    if (!matchAttr(reversal.attr, hitDef.attr)) return false;
    reversal.done = true;
    hitDef.done = true;
    defender.moveContact = defender.moveHit = true;
    defender.hitPause = Math.max(0, reversal.pause[0]);
    attacker.hitPause = Math.max(0, reversal.pause[1]);
    if (reversal.p1stateno >= 0) {
      defender.changeState(reversal.p1stateno, defender.pkg);
      defender.ctrl = false;
    }
    if (reversal.p2stateno >= 0) {
      // the reversed attacker enters a state owned by the reversing character
      attacker.changeState(reversal.p2stateno, defender.pkg);
      attacker.movetype = 'H';
      attacker.ctrl = false;
    }
    G.burst((attacker.x + defender.x) / 2, GROUND - 90, '#fff', 14, 6);
    Snd.block();
    return true;
  },

  /**
   * Resolve every hit of the tick: HitDefs of players and helpers, projectiles, and projectile clashes.
   * @param {object} fighterA First player.
   * @param {object} fighterB Second player.
   */
  hits(fighterA, fighterB) {
    // attackers: each player and its helpers; defenders are always the opposing player
    const attackPairs = [
      [fighterA, fighterB],
      [fighterB, fighterA]
    ];
    for (const helper of fighterA.helpers) attackPairs.push([helper, fighterB]);
    for (const helper of fighterB.helpers) attackPairs.push([helper, fighterA]);
    const bestAttack = new Map(); // defender -> the single attack that lands on it this tick
    for (const [attacker, defender] of attackPairs) {
      const hitDef = attacker.hitdef;
      if (!hitDef || hitDef.rev || hitDef.done || attacker.movetype !== 'A' || attacker.hitPause > 0 || attacker.dead)
        continue;
      const contactPoint = Mugen.overlap(Mugen.boxes(attacker, 1), Mugen.boxes(defender, 2));
      if (!contactPoint) continue;
      if (Mugen.tryReversal(attacker, defender, hitDef)) continue;
      if (!Mugen.canHit(attacker, defender, hitDef, false)) continue;
      const current = bestAttack.get(defender);
      if (!current || hitDef.prio > current.hitDef.prio)
        bestAttack.set(defender, { attacker, defender, hitDef, contactPoint });
    }
    // both players hit each other on the same tick: the higher priority wins, equal priority trades
    const hitJobs = [...bestAttack.values()];
    if (hitJobs.length === 2) {
      const [firstJob, secondJob] = hitJobs;
      if (firstJob.hitDef.prio > secondJob.hitDef.prio) hitJobs.pop();
      else if (secondJob.hitDef.prio > firstJob.hitDef.prio) hitJobs.shift();
    }
    for (const job of hitJobs) Mugen.applyHit(job.attacker, job.defender, job.hitDef, job.contactPoint, null);
    /* projectiles (players' and helpers') */
    for (const [attacker, defender] of attackPairs)
      for (const projectile of attacker.projs) {
        if (projectile.state !== 'fly' || projectile.cool > 0 || !projectile.hitDef) continue;
        const contactPoint = Mugen.overlap(Mugen.projBoxes(projectile), Mugen.boxes(defender, 2));
        if (!contactPoint) continue;
        if (!Mugen.canHit(attacker, defender, projectile.hitDef, true)) continue;
        Mugen.applyHit(attacker, defender, projectile.hitDef, contactPoint, projectile);
        projectile.hits--;
        projectile.cool = Math.max(1, projectile.misstime);
        if (projectile.hits <= 0 && projectile.remove) {
          if (projectile.hitAnim >= 0 && attacker.pkg.air.has(projectile.hitAnim)) {
            // play the hit animation, frozen in place, before disappearing
            projectile.animation.set(projectile.hitAnim);
            projectile.state = 'hit';
            projectile.endT = projectile.time + 60;
            projectile.velX = projectile.velY = projectile.ax = projectile.ay = 0;
          } else projectile.dead = true;
          projectile.done = true;
        }
      }
    /* projectile vs projectile: the one with the lower priority is destroyed, equal priorities cancel out */
    for (const ownerA of [fighterA, ...fighterA.helpers])
      for (const ownerB of [fighterB, ...fighterB.helpers])
        for (const projectile of ownerA.projs)
          for (const otherProjectile of ownerB.projs) {
            if (
              projectile.state !== 'fly' ||
              otherProjectile.state !== 'fly' ||
              !Mugen.overlap(Mugen.projBoxes(projectile), Mugen.projBoxes(otherProjectile))
            )
              continue;
            if (projectile.prio >= otherProjectile.prio) {
              otherProjectile.dead = true;
            }
            if (otherProjectile.prio >= projectile.prio) {
              projectile.dead = true;
            }
            G.burst((projectile.wx + otherProjectile.wx) / 2, GROUND + projectile.posY * projectile.s, '#fff', 14, 6);
            G.ring((projectile.wx + otherProjectile.wx) / 2, GROUND + projectile.posY * projectile.s, '#fff', 70);
          }
  },

  /**
   * Apply BindToTarget / TargetBind: keep bound fighters glued to their bind target.
   * @param {object} fighterA First player.
   * @param {object} fighterB Second player.
   */
  applyBinds(fighterA, fighterB) {
    for (const fighter of [fighterA, fighterB]) {
      const bind = fighter.bindT;
      if (!bind) continue;
      if (bind.t <= 0 || bind.to.life < 0) {
        fighter.bindT = null;
        fighter.bound = 0;
        continue;
      }
      const target = bind.to;
      fighter.posX = target.posX + bind.x * (bind.tgt ? target.face : target.face) * (target.s / fighter.s);
      fighter.posY = target.posY + bind.y;
      fighter.velX = fighter.velY = 0;
      bind.t--;
      fighter.bound = bind.t;
    }
  },

  /* ---------- the world tick ---------- */

  /**
   * Advance the whole world by one tick: updates, pause handling, hits, body push, camera and stage bounds.
   * @param {object} fighterA First player.
   * @param {object} fighterB Second player.
   */
  tick(fighterA, fighterB) {
    fighterA.opponent = fighterB;
    fighterB.opponent = fighterA;
    const pauseState = Mugen.pause;
    if (pauseState && pauseState.t > 0) {
      // frozen world: only entities with remaining "pausedMove" keep running
      pauseState.t--;
      if (pauseState.t <= 0) Mugen.pause = null;
      for (const fighter of [fighterA, fighterB]) {
        if (fighter.pausedMove > 0) fighter.update();
        else fighter.readInput();
      }
      for (const helper of Mugen.allHelpers(fighterA, fighterB))
        if (helper.pausedMove > 0) {
          helper.opponent = helper.root.opponent;
          helper.update();
          Mugen.bindHelper(helper);
        }
    } else {
      fighterA.update();
      fighterB.update();
      Mugen.applyBinds(fighterA, fighterB);
      // helpers run after both players; one spawned this tick (pushed during fighterA.update) already updates now
      for (const root of [fighterA, fighterB])
        for (let index = 0; index < root.helpers.length; index++) {
          const helper = root.helpers[index];
          helper.opponent = root.opponent;
          helper.update();
          Mugen.bindHelper(helper);
        }
      for (const root of [fighterA, fighterB])
        if (root.helpers.length) root.helpers = root.helpers.filter(helper => !helper.dead);
      for (const fighter of [fighterA, fighterB, ...Mugen.allHelpers(fighterA, fighterB)]) {
        Mugen.updateProjs(fighter);
        Mugen.updateExplods(fighter);
      }
      Mugen.hits(fighterA, fighterB);
      for (const fighter of [fighterA, fighterB]) {
        if (fighter.life <= 0 && !fighter.koSent) Mugen.ko(fighter, fighter.opponent);
      }
    }
    /* body push: overlapping fighters are separated, preferring to push the one not against a wall */
    if (fighterA.type !== 'L' && fighterB.type !== 'L') {
      const deltaX = fighterB.x - fighterA.x,
        sign = deltaX >= 0 ? 1 : -1,
        widthA = (sign === fighterA.face ? fighterA.frontW() : fighterA.backW()) * fighterA.s,
        widthB = (sign === -fighterB.face ? fighterB.frontW() : fighterB.backW()) * fighterB.s,
        overlapDepth = widthA + widthB - Math.abs(deltaX);
      const verticalOverlap =
        Math.abs(fighterA.posY * fighterA.s - fighterB.posY * fighterB.s) <
        Math.min(fighterA.const('size.height') * fighterA.s, fighterB.const('size.height') * fighterB.s);
      if (overlapDepth > 0 && verticalOverlap) {
        const margin = 40,
          aAtWall = fighterA.x <= G.cam.x + margin + 2 || fighterA.x >= G.cam.x + W - margin - 2,
          bAtWall = fighterB.x <= G.cam.x + margin + 2 || fighterB.x >= G.cam.x + W - margin - 2;
        if (aAtWall && !bAtWall) fighterB.x += sign * overlapDepth;
        else if (bAtWall && !aAtWall) fighterA.x -= sign * overlapDepth;
        else {
          fighterA.x -= (sign * overlapDepth) / 2;
          fighterB.x += (sign * overlapDepth) / 2;
        }
      }
    }
    /* camera follows the midpoint between the fighters, limited by the stage */
    const stage = G.stage,
      camMin = stage ? stage.camMin : 0,
      camMax = stage ? stage.camMax : STAGE_W - W;
    const midpoint = (fighterA.x + fighterB.x) / 2,
      camTarget = clamp(midpoint - W / 2, camMin, camMax);
    G.cam.x = lerp(G.cam.x, camTarget, 0.14);
    /* keep fighters inside the screen and the stage bounds (bound fighters are positioned by their bind) */
    for (const fighter of [fighterA, fighterB]) {
      if (fighter.bindT) continue;
      let margin = fighter.type === 'L' ? 70 : Math.max(36, fighter.backW() * fighter.s);
      if (stage) margin = Math.max(margin, stage.edgeL || 0);
      let minX = G.cam.x + margin,
        maxX = G.cam.x + W - margin;
      if (stage) {
        minX = Math.max(minX, stage.leftB);
        maxX = Math.min(maxX, stage.rightB);
      }
      fighter.x = clamp(fighter.x, minX, Math.max(minX, maxX));
    }
    /* combo counter display: shown for 70 ticks after the opponent was last comboed */
    for (const [fighter, other] of [
      [fighterA, fighterB],
      [fighterB, fighterA]
    ]) {
      if (other.combo > 1) {
        fighter.comboShow = 70;
        fighter.comboHits = other.combo;
      } else if (fighter.comboShow > 0) fighter.comboShow--;
    }
  },

  /* ---------- a simple opponent AI that works with any command set ---------- */

  /**
   * Build a CPU controller. It picks a short random plan (wait / walk / jump / attack / special / guard) every few
   * ticks and returns the virtual key presses for each tick.
   * @param {number} [level] Difficulty 1..8 (default 4); higher levels guard more often.
   * @returns {function(object, object): object} Function (fighter, opponent) -> input map {right, left, up, down, lp, ...}.
   */
  makeAI(level) {
    level = level || 4;
    let plan = null,
      until = 0, // tick at which the current plan expires
      ticks = 0;
    return (fighter, opponent) => {
      ticks++;
      const random = Math.random,
        distance = Math.abs(opponent.x - fighter.x) / fighter.s / fighter.k240,
        inputs = {};
      if (!plan || ticks >= until) {
        plan = { k: 'wait' };
        until = ticks + 6 + Math.floor(random() * 14);
        const opponentAttacking = opponent.movetype === 'A' && distance < 130;
        if (opponentAttacking && random() < 0.15 + level * 0.07) {
          plan = { k: 'guard', low: opponent.type === 'C' && random() < 0.5 };
        } else if (distance > 90) {
          // far away: approach, jump in or try a special move
          const roll = random();
          plan = roll < 0.6 ? { k: 'fwd' } : roll < 0.75 ? { k: 'jump' } : roll < 0.9 ? { k: 'cmd' } : { k: 'wait' };
        } else {
          // close: attack, special, retreat or jump
          const roll = random();
          plan =
            roll < 0.45
              ? { k: 'hit', b: ['lp', 'hp', 'lk', 'hk'][Math.floor(random() * 4)], low: random() < 0.2 }
              : roll < 0.62
                ? { k: 'cmd' }
                : roll < 0.78
                  ? { k: 'back' }
                  : roll < 0.88
                    ? { k: 'jump' }
                    : { k: 'wait' };
        }
        plan.t0 = ticks;
      }
      const first = ticks - plan.t0 < 2; // button presses only on the first ticks of a plan
      switch (plan.k) {
        case 'fwd':
          if (fighter.face > 0) inputs.right = 1;
          else inputs.left = 1;
          break;
        case 'back':
          if (fighter.face > 0) inputs.left = 1;
          else inputs.right = 1;
          break;
        case 'guard':
          if (fighter.face > 0) inputs.left = 1;
          else inputs.right = 1;
          if (plan.low) inputs.down = 1;
          break;
        case 'jump':
          inputs.up = 1;
          if (fighter.face > 0) inputs.right = 1;
          else inputs.left = 1;
          break;
        case 'hit':
          if (plan.low) inputs.down = 1;
          if (first) inputs[plan.b] = 1;
          break;
        case 'cmd':
          if (first && !plan.done) {
            plan.done = true;
            // pick a random multi-step command (specials) from the character's command list and force it
            const names = fighter.pkg.commands
              .filter(
                command =>
                  !/^(hold|fwd$|back$|up$|down$|recovery|start)/i.test(command.name) &&
                  (command.steps.length > 1 || command.steps[0].keys.length > 1)
              )
              .map(command => command.name);
            if (names.length) fighter.force[names[Math.floor(random() * names.length)].toLowerCase()] = 4;
            else inputs.lp = 1;
          }
          break;
      }
      return inputs;
    };
  }
};
