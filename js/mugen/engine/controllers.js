/* =====================================================================
   State controllers (MCTL): one function per MUGEN controller type, called
   with the fighter as `this` and the parsed controller as its argument.
   MQUIET lists controllers that are accepted and deliberately ignored
   (cosmetic effects); anything else unknown is reported once via MG.warn.
   ===================================================================== */
/** Controllers that are accepted and deliberately ignored (cosmetic effects). */
const MQUIET = new Set([
  'afterimage',
  'afterimagetime',
  'palfx',
  'allpalfx',
  'bgpalfx',
  'remappal',
  'makedust',
  'gamemakeanim',
  'forcefeedback',
  'displaytoclipboard',
  'appendtoclipboard',
  'clearclipboard',
  'modifyexplod',
  'offset',
  'angledraw',
  'angleadd',
  'anglemul',
  'angleset',
  'bgpalfx',
  'trans',
  'null',
  'sndpan',
  'screenbound',
  'playerpush',
  'text',
  'modifyprojectile',
  'targetdrop',
  'victoryquote',
  'envcolor',
  'hitoverride',
  'dizzypointsadd',
  'dizzypointsset',
  'guardpointsadd',
  'guardpointsset',
  'redlifeadd',
  'redlifeset',
  'lifebaradd'
]);
/** Controller implementations, keyed by lower-case MUGEN controller name; `this` is the fighter. */
const MCTL = {
  /**
   * ChangeState: switch to another state of this character, optionally setting ctrl and the animation.
   * @param {object} controller parsed controller
   */
  changestate(controller) {
    const value = this.n(controller, 'value', 0, 0) | 0;
    this.changeState(value);
    if (this.has(controller, 'ctrl')) this.ctrl = !!this.n(controller, 'ctrl');
    if (this.has(controller, 'anim')) this.changeAnim(this.n(controller, 'anim') | 0);
  },
  /**
   * SelfState: like ChangeState, but the new state is looked up in the fighter's own state files.
   * @param {object} controller parsed controller
   */
  selfstate(controller) {
    const value = this.n(controller, 'value', 0, 0) | 0;
    this.stOwner = this.pkg;
    this.changeState(value, this.pkg);
    if (this.has(controller, 'ctrl')) this.ctrl = !!this.n(controller, 'ctrl');
    if (this.has(controller, 'anim')) this.changeAnim(this.n(controller, 'anim') | 0);
  },
  /**
   * ChangeAnim: play another action of this character (`elem` is 1-based in MUGEN, 0-based internally).
   * @param {object} controller parsed controller
   */
  changeanim(controller) {
    this.changeAnim(this.n(controller, 'value', 0, 0) | 0, Math.max(0, this.n(controller, 'elem', 0, 1) - 1));
  },
  /**
   * ChangeAnim2: play an action taken from the state owner's package (used when in a foreign state).
   * @param {object} controller parsed controller
   */
  changeanim2(controller) {
    this.changeAnim(
      this.n(controller, 'value', 0, 0) | 0,
      Math.max(0, this.n(controller, 'elem', 0, 1) - 1),
      this.stOwner
    );
  },
  /**
   * PlaySnd: play a sound; value is "[F|S]group,number" (F = common fight effect, S = own SND).
   * @param {object} controller parsed controller
   */
  playsnd(controller) {
    let soundSpec = this.raw(controller, 'value'),
      isFightFx = false; // true = common fight-effect sound (prefix F), false = own SND (prefix S)
    const prefixMatch = soundSpec.match(/^\s*([FfSs])(?=[\s\d-])/);
    if (prefixMatch) {
      isFightFx = prefixMatch[1].toUpperCase() === 'F';
      soundSpec = soundSpec.slice(prefixMatch[0].length);
    }
    const soundArgs = MG.compileList(soundSpec),
      soundGroup = soundArgs[0] ? soundArgs[0].f(this) : 0,
      soundNumber = soundArgs[1] ? soundArgs[1].f(this) : 0;
    const halfScreen = (this.pkg.local ? this.pkg.local[0] : 320) / 2,
      absolutePan = this.n(controller, 'abspan', 0, 0),
      panOffset = this.has(controller, 'abspan') ? absolutePan : this.n(controller, 'pan', 0, 0) * this.face;
    Mugen.playSnd(this.pkg, isFightFx, soundGroup | 0, soundNumber | 0, {
      vol: this.n(controller, 'volumescale', 0, 100) / 100,
      pan: clamp(panOffset / halfScreen, -1, 1),
      freq: this.n(controller, 'freqmul', 0, 1),
      loop: this.n(controller, 'loop', 0, 0) !== 0,
      channel: this.has(controller, 'channel') ? this.n(controller, 'channel', 0, -1) | 0 : undefined,
      lowpriority: this.n(controller, 'lowpriority', 0, 0) !== 0
    });
  },
  /**
   * StopSnd: stop whatever plays on the given sound channel.
   * @param {object} controller parsed controller
   */
  stopsnd(controller) {
    Snd.stopChannel(this.n(controller, 'channel', 0, -1) | 0);
  },
  /**
   * PosAdd: offset the position (x is mirrored by the facing).
   * @param {object} controller parsed controller
   */
  posadd(controller) {
    if (this.has(controller, 'x')) this.posX += this.n(controller, 'x') * this.face;
    if (this.has(controller, 'y')) this.posY += this.n(controller, 'y');
  },
  /**
   * PosSet: set the position.
   * @param {object} controller parsed controller
   */
  posset(controller) {
    if (this.has(controller, 'x')) this.posX = this.n(controller, 'x');
    if (this.has(controller, 'y')) this.posY = this.n(controller, 'y');
  },
  /**
   * PosFreeze: do not apply the velocity to the position this tick.
   * @param {object} controller parsed controller
   */
  posfreeze(controller) {
    if (this.has(controller, 'value') ? this.n(controller, 'value', 0, 1) : 1) this.posFreeze = true;
  },
  /**
   * VelSet: set the velocity.
   * @param {object} controller parsed controller
   */
  velset(controller) {
    if (this.has(controller, 'x')) this.velX = this.n(controller, 'x');
    if (this.has(controller, 'y')) this.velY = this.n(controller, 'y');
  },
  /**
   * VelAdd: add to the velocity.
   * @param {object} controller parsed controller
   */
  veladd(controller) {
    if (this.has(controller, 'x')) this.velX += this.n(controller, 'x');
    if (this.has(controller, 'y')) this.velY += this.n(controller, 'y');
  },
  /**
   * VelMul: multiply the velocity.
   * @param {object} controller parsed controller
   */
  velmul(controller) {
    if (this.has(controller, 'x')) this.velX *= this.n(controller, 'x');
    if (this.has(controller, 'y')) this.velY *= this.n(controller, 'y');
  },
  /**
   * Gravity: add the character's vertical acceleration to the Y velocity.
   */
  gravity() {
    this.velY += this.const('movement.yaccel');
  },
  /**
   * CtrlSet: give or take away player control.
   * @param {object} controller parsed controller
   */
  ctrlset(controller) {
    this.ctrl = !!this.n(controller, 'value', 0, 0);
  },
  /**
   * Turn: face the other way.
   */
  turn() {
    this.face = -this.face;
  },
  /**
   * Width: override the push width (front/back) for this tick.
   * @param {object} controller parsed controller
   */
  width(controller) {
    if (this.has(controller, 'value'))
      this.widthOv = [this.n(controller, 'value', 0, 0), this.n(controller, 'value', 1, 0)];
    else if (this.has(controller, 'player'))
      this.widthOv = [this.n(controller, 'player', 0, 0), this.n(controller, 'player', 1, 0)];
  },
  /**
   * StateTypeSet: change statetype / movetype / physics (first letter of each parameter).
   * @param {object} controller parsed controller
   */
  statetypeset(controller) {
    // first letter of a parameter, e.g. "Stand" -> "S"
    const firstLetter = key => this.raw(controller, key).trim().toUpperCase()[0];
    let value = firstLetter('statetype');
    if (value && 'SCAL'.indexOf(value) >= 0) this.type = value;
    value = firstLetter('movetype');
    if (value && 'IAH'.indexOf(value) >= 0) this.movetype = value;
    value = firstLetter('physics');
    if (value && 'SCAN'.indexOf(value) >= 0) this.physics = value;
  },
  /**
   * LifeAdd: change life; negative damage is reduced by defence unless `absolute`, and `kill` decides if it may reach 0.
   * @param {object} controller parsed controller
   */
  lifeadd(controller) {
    let value = this.n(controller, 'value', 0, 0);
    if (!this.n(controller, 'absolute', 0, 0) && value < 0)
      value = value / ((this.const('data.defence') / 100) * (this.defMul || 1));
    this.life += Math.trunc(value);
    if (!this.n(controller, 'kill', 0, 1) && this.life < 1) this.life = 1;
    this.life = Math.max(0, Math.min(this.maxHp, this.life));
    if (this.life <= 0) Mugen.ko(this, this);
  },
  /**
   * LifeSet: set life directly (clamped to 0..max).
   * @param {object} controller parsed controller
   */
  lifeset(controller) {
    this.life = Math.max(0, Math.min(this.maxHp, this.n(controller, 'value', 0, this.life)));
    if (this.life <= 0) Mugen.ko(this, this);
  },
  /**
   * PowerAdd: add to the power gauge.
   * @param {object} controller parsed controller
   */
  poweradd(controller) {
    this.addPower(this.n(controller, 'value', 0, 0));
  },
  /**
   * PowerSet: set the power gauge (clamped to 0..max).
   * @param {object} controller parsed controller
   */
  powerset(controller) {
    this.power = Math.max(0, Math.min(this.powerMax, this.n(controller, 'value', 0, 0)));
  },
  /**
   * VarSet: assign var/fvar/sysvar/sysfvar (expression form `var(n) = x`, or v/fv + value).
   * @param {object} controller parsed controller
   */
  varset(controller) {
    for (const key in controller.params)
      if (/^(var|fvar|sysvar|sysfvar)\s*\(/i.test(key))
        MG.compile(key.replace(/\s+/g, '') + ' := (' + controller.params[key] + ')').f(this);
    if (this.has(controller, 'v')) {
      const index = this.n(controller, 'v') | 0,
        value = this.n(controller, 'value', 0, 0);
      if (index >= 0 && index < 60) this.vars[index] = Math.trunc(value);
    }
    if (this.has(controller, 'fv')) {
      const index = this.n(controller, 'fv') | 0,
        value = this.n(controller, 'value', 0, 0);
      if (index >= 0 && index < 60) this.fvars[index] = value;
    }
  },
  /**
   * VarAdd: add to var/fvar/sysvar/sysfvar (same parameter forms as VarSet).
   * @param {object} controller parsed controller
   */
  varadd(controller) {
    for (const key in controller.params)
      if (/^(var|fvar|sysvar|sysfvar)\s*\(/i.test(key)) {
        const compactKey = key.replace(/\s+/g, '');
        MG.compile(compactKey + ' := ' + compactKey + ' + (' + controller.params[key] + ')').f(this);
      }
    if (this.has(controller, 'v')) {
      const index = this.n(controller, 'v') | 0;
      if (index >= 0 && index < 60) this.vars[index] = Math.trunc(this.vars[index] + this.n(controller, 'value', 0, 0));
    }
    if (this.has(controller, 'fv')) {
      const index = this.n(controller, 'fv') | 0;
      if (index >= 0 && index < 60) this.fvars[index] += this.n(controller, 'value', 0, 0);
    }
  },
  /**
   * VarRandom: store a random integer in `range` (default 0..1000) into var(v).
   * @param {object} controller parsed controller
   */
  varrandom(controller) {
    const index = this.n(controller, 'v', 0, 0) | 0;
    let lo = 0,
      hi = 1000;
    if (this.has(controller, 'range')) {
      const list = this.L(controller, 'range');
      if (list.length > 1) {
        lo = this.n(controller, 'range', 0);
        hi = this.n(controller, 'range', 1);
      } else hi = this.n(controller, 'range', 0);
    }
    if (index >= 0 && index < 60) this.vars[index] = lo + Math.floor(MG.rand() * (hi - lo + 1));
  },
  /**
   * VarRangeSet: set a range of vars (value) and/or fvars (fvalue) from `first` to `last`.
   * @param {object} controller parsed controller
   */
  varrangeset(controller) {
    const first = this.n(controller, 'first', 0, 0) | 0,
      last = this.n(controller, 'last', 0, 59) | 0;
    for (let index = Math.max(0, first); index <= Math.min(59, last); index++) {
      if (this.has(controller, 'value')) this.vars[index] = Math.trunc(this.n(controller, 'value'));
      if (this.has(controller, 'fvalue')) this.fvars[index] = this.n(controller, 'fvalue');
    }
  },
  /**
   * HitDef: define the attack of the current move.
   * @param {object} controller parsed controller
   */
  hitdef(controller) {
    this.hitdef = parseHitDef(this, controller, false);
  },
  /**
   * ReversalDef: define a reversal (counter) attack.
   * @param {object} controller parsed controller
   */
  reversaldef(controller) {
    this.hitdef = parseHitDef(this, controller, true);
  },
  /**
   * Shared implementation of HitBy / NotHitBy: fill the hitby slots (`value`, `value2`) with an attribute filter.
   * @param {object} controller parsed controller
   * @param {boolean} not true for NotHitBy, false for HitBy
   */
  notHitBy(controller, not) {
    for (const slot of [0, 1]) {
      const key = slot === 0 ? 'value' : 'value2';
      if (!this.has(controller, key)) continue;
      this.hitby[slot] = { not, attr: parseAttr(this.raw(controller, key)), time: this.n(controller, 'time', 0, 1) };
    }
  },
  /**
   * NotHitBy: become immune to attacks matching the attributes.
   * @param {object} controller parsed controller
   */
  nothitby(controller) {
    MCTL.notHitBy.call(this, controller, true);
  },
  /**
   * HitBy: only attacks matching the attributes can hit.
   * @param {object} controller parsed controller
   */
  hitby(controller) {
    MCTL.notHitBy.call(this, controller, false);
  },
  /**
   * HitVelSet: apply the GetHitVar velocities to this fighter.
   * @param {object} controller parsed controller
   */
  hitvelset(controller) {
    const getHitVars = this.getHit;
    if (this.n(controller, 'x', 0, 0)) this.velX = getHitVars.xvel * this.face;
    if (this.n(controller, 'y', 0, 0)) this.velY = getHitVars.yvel;
  },
  /**
   * HitFallVel: apply the fall velocities of the last hit.
   */
  hitfallvel() {
    const getHitVars = this.getHit;
    if (getHitVars['fall.xvelset']) this.velX = getHitVars['fall.xvel'] * this.face;
    this.velY = getHitVars['fall.yvel'];
  },
  /**
   * HitFallDamage: take the pending fall damage (may KO).
   */
  hitfalldamage() {
    const getHitVars = this.getHit;
    const damage = getHitVars['fall.damage'] | 0;
    if (damage > 0) {
      this.life = Math.max(getHitVars['fall.kill'] ? 0 : 1, this.life - damage);
      getHitVars['fall.damage'] = 0;
      if (this.life <= 0) Mugen.ko(this, this.opponent || this);
    }
  },
  /**
   * HitFallSet: change the fall flag and fall velocities of the last hit.
   * @param {object} controller parsed controller
   */
  hitfallset(controller) {
    const getHitVars = this.getHit,
      value = this.n(controller, 'value', 0, -1);
    if (value >= 0) getHitVars.fall = value ? 1 : 0;
    if (this.has(controller, 'xvel')) {
      getHitVars['fall.xvel'] = this.n(controller, 'xvel');
      getHitVars['fall.xvelset'] = true;
    }
    if (this.has(controller, 'yvel')) getHitVars['fall.yvel'] = this.n(controller, 'yvel');
  },
  /**
   * HitAdd: accepted but has no effect.
   */
  hitadd() {},
  /**
   * FallEnvShake: shake the screen when a falling fighter lands.
   */
  fallenvshake() {
    const getHitVars = this.getHit;
    if (getHitVars.fallShakeT > 0)
      G.shake = Math.max(G.shake, Math.min(16, Math.abs(getHitVars.fallShakeA) * this.s * 0.5));
  },
  /**
   * Ground-impact effect (not a MUGEN controller name): dust and a dull thud.
   */
  hitgroundfx() {
    G.dust(this.x, 5);
    Snd.noise(0.08, 0.15, 300, 0.8);
  },
  /**
   * DefenceMulSet: set the defence multiplier.
   * @param {object} controller parsed controller
   */
  defencemulset(controller) {
    this.defMul = Math.max(0.01, this.n(controller, 'value', 0, 1));
  },
  /**
   * AttackMulSet: set the attack multiplier.
   * @param {object} controller parsed controller
   */
  attackmulset(controller) {
    this.atkMul = this.n(controller, 'value', 0, 1);
  },
  /**
   * MoveHitReset: clear MoveContact / MoveHit / MoveGuarded.
   */
  movehitreset() {
    this.moveContact = this.moveHit = this.moveGuarded = false;
  },
  /**
   * AssertSpecial: raise special flags (flag, flag2, flag3) for this tick.
   * @param {object} controller parsed controller
   */
  assertspecial(controller) {
    for (const key of ['flag', 'flag2', 'flag3'])
      if (this.has(controller, key)) this.asf.add(this.raw(controller, key).toLowerCase());
  },
  /**
   * SprPriority: set the sprite drawing priority.
   * @param {object} controller parsed controller
   */
  sprpriority(controller) {
    this.sprPri = this.n(controller, 'value', 0, 0);
  },
  /**
   * Pause: freeze the world; this fighter and its helpers may keep moving for `movetime` ticks.
   * @param {object} controller parsed controller
   */
  pause(controller) {
    Mugen.pause = { t: this.n(controller, 'time', 0, 0), owner: this };
    this.pausedMove = this.n(controller, 'movetime', 0, 0);
    Mugen.pauseHelpers(this, false);
  },
  /**
   * SuperPause: like Pause plus darkening, screen effects, optional sound, animation and power gain.
   * @param {object} controller parsed controller
   */
  superpause(controller) {
    const pauseTime = this.n(controller, 'time', 0, 30);
    Mugen.pause = { t: pauseTime, owner: this, dark: this.n(controller, 'darken', 0, 1) };
    this.pausedMove = this.n(controller, 'movetime', 0, 0);
    Mugen.pauseHelpers(this, true);
    if (this.has(controller, 'poweradd')) this.addPower(this.n(controller, 'poweradd'));
    G.flash = Math.max(G.flash, 0.5);
    G.shake = Math.max(G.shake, 5);
    if (this.has(controller, 'p2defmul') && this.opponent)
      this.opponent.defMul = Math.max(0.01, this.n(controller, 'p2defmul', 0, 1));
    const soundSpec = this.raw(controller, 'sound');
    if (soundSpec) {
      const soundMatch = soundSpec.match(/^\s*([FfSs])?\s*(-?\d+)\s*,\s*(-?\d+)/);
      if (soundMatch)
        Mugen.playSnd(this.pkg, (soundMatch[1] || 'S').toUpperCase() === 'F', +soundMatch[2], +soundMatch[3], {});
    }
    if (this.has(controller, 'anim')) {
      const animSpec = this.raw(controller, 'anim');
      // "F<n>" refers to the common fight-effect animations, which are not available
      if (!/^\s*[Ff]/.test(animSpec))
        Mugen.addExplod(this, {
          anim: this.n(controller, 'anim') | 0,
          id: -7,
          postype: 'p1',
          pos: [0, 0],
          removetime: -2,
          ontop: true
        });
    }
  },
  /**
   * EnvShake: shake the screen.
   * @param {object} controller parsed controller
   */
  envshake(controller) {
    G.shake = Math.max(G.shake, Math.min(18, Math.abs(this.n(controller, 'ampl', 0, -4)) * this.s * 0.45));
  },
  /**
   * Explod: spawn a cosmetic animation (fight-effect "F" animations are not available and are skipped).
   * @param {object} controller parsed controller
   */
  explod(controller) {
    const animSpec = this.raw(controller, 'anim');
    if (/^\s*[Ff]/.test(animSpec)) return; // common fight-effect animation: not available
    Mugen.addExplod(this, {
      anim: this.n(controller, 'anim') | 0,
      id: this.n(controller, 'id', 0, -1) | 0,
      postype: this.raw(controller, 'postype', 'p1').toLowerCase(),
      pos: [this.n(controller, 'pos', 0, 0), this.n(controller, 'pos', 1, 0)],
      facing: this.n(controller, 'facing', 0, 1),
      vel: [this.n(controller, 'vel', 0, 0), this.n(controller, 'vel', 1, 0)],
      accel: [this.n(controller, 'accel', 0, 0), this.n(controller, 'accel', 1, 0)],
      removetime: this.n(controller, 'removetime', 0, -2),
      bindtime: this.n(controller, 'bindtime', 0, 1),
      scale: [this.n(controller, 'scale', 0, 1), this.n(controller, 'scale', 1, 1)],
      ontop: !!this.n(controller, 'ontop', 0, 0),
      sprpri: this.n(controller, 'sprpriority', 0, 0),
      trans: this.raw(controller, 'trans', '')
    });
  },
  /**
   * RemoveExplod: remove the explods with the given id (id < 0 removes all).
   * @param {object} controller parsed controller
   */
  removeexplod(controller) {
    const id = this.n(controller, 'id', 0, -1) | 0;
    this.explods = this.explods.filter(explod => id >= 0 && explod.id !== id);
  },
  /**
   * Projectile: spawn a projectile.
   * @param {object} controller parsed controller
   */
  projectile(controller) {
    Mugen.addProj(this, controller);
  },
  /**
   * TargetState: force the target into a state of this character.
   * @param {object} controller parsed controller
   */
  targetstate(controller) {
    const target = this.target;
    if (!target || target.life < 0) return;
    const value = this.n(controller, 'value', 0, 0) | 0;
    target.changeState(value, this.pkg);
    target.getHit.pending = false;
  },
  /**
   * TargetBind: glue the target to this fighter at an offset for some ticks.
   * @param {object} controller parsed controller
   */
  targetbind(controller) {
    const target = this.target;
    if (!target) return;
    target.bindT = {
      to: this,
      t: this.n(controller, 'time', 0, 1),
      x: this.n(controller, 'pos', 0, 0),
      y: this.n(controller, 'pos', 1, 0)
    };
  },
  /**
   * BindToTarget: glue this fighter to the target at an offset for some ticks.
   * @param {object} controller parsed controller
   */
  bindtotarget(controller) {
    const target = this.target;
    if (!target) return;
    this.bindT = {
      to: target,
      t: this.n(controller, 'time', 0, 1),
      x: this.n(controller, 'pos', 0, 0),
      y: this.n(controller, 'pos', 1, 0),
      tgt: true
    };
  },
  /**
   * TargetFacing: make the target face the same (value >= 0) or the opposite way.
   * @param {object} controller parsed controller
   */
  targetfacing(controller) {
    const target = this.target;
    if (!target) return;
    const value = this.n(controller, 'value', 0, 1);
    target.face = value >= 0 ? this.face : -this.face;
  },
  /**
   * TargetVelAdd: add to the target's velocity.
   * @param {object} controller parsed controller
   */
  targetveladd(controller) {
    const target = this.target;
    if (!target) return;
    if (this.has(controller, 'x')) target.velX += this.n(controller, 'x');
    if (this.has(controller, 'y')) target.velY += this.n(controller, 'y');
  },
  /**
   * TargetVelSet: set the target's velocity.
   * @param {object} controller parsed controller
   */
  targetvelset(controller) {
    const target = this.target;
    if (!target) return;
    if (this.has(controller, 'x')) target.velX = this.n(controller, 'x');
    if (this.has(controller, 'y')) target.velY = this.n(controller, 'y');
  },
  /**
   * TargetLifeAdd: change the target's life (may KO it).
   * @param {object} controller parsed controller
   */
  targetlifeadd(controller) {
    const target = this.target;
    if (!target) return;
    let value = this.n(controller, 'value', 0, 0);
    if (!this.n(controller, 'absolute', 0, 0)) value *= 1;
    target.life = Math.max(0, Math.min(target.maxHp, target.life + Math.trunc(value)));
    if (!this.n(controller, 'kill', 0, 1) && target.life < 1) target.life = 1;
    if (target.life <= 0) Mugen.ko(target, this);
  },
  /**
   * TargetPowerAdd: add to the target's power gauge.
   * @param {object} controller parsed controller
   */
  targetpoweradd(controller) {
    const target = this.target;
    if (target) target.addPower(this.n(controller, 'value', 0, 0));
  },
  /**
   * Helper: spawn a helper character.
   * @param {object} controller parsed controller
   */
  helper(controller) {
    Mugen.addHelper(this, {
      id: this.n(controller, 'id', 0, 0) | 0,
      name: this.raw(controller, 'name', 'helper'),
      stateno: this.n(controller, 'stateno', 0, 0) | 0,
      postype: this.raw(controller, 'postype', 'p1').toLowerCase(),
      pos: [this.n(controller, 'pos', 0, 0), this.n(controller, 'pos', 1, 0)],
      facing: this.n(controller, 'facing', 0, 1),
      pausemovetime: this.n(controller, 'pausemovetime', 0, 0),
      supermovetime: this.n(controller, 'supermovetime', 0, 0)
    });
  },
  /**
   * DestroySelf: remove this helper (ignored for players).
   */
  destroyself() {
    if (this.isHelper) this.dead = true;
  },
  /**
   * ParentVarSet: assign variables of the parent.
   * @param {object} controller parsed controller
   */
  parentvarset(controller) {
    if (this.parent) MCTL.setVars.call(this, controller, this.parent, false);
  },
  /**
   * ParentVarAdd: add to variables of the parent.
   * @param {object} controller parsed controller
   */
  parentvaradd(controller) {
    if (this.parent) MCTL.setVars.call(this, controller, this.parent, true);
  },
  /**
   * Write var(n)/fvar(n) (and the v/fv + value form) into another player; values are evaluated here.
   * @param {object} controller parsed controller
   * @param {object} targetFighter fighter whose variables are written
   * @param {boolean} add true to add to the existing value, false to overwrite
   */
  setVars(controller, targetFighter, add) {
    const put = (array, index, value, asInteger) => {
      if (index >= 0 && index < array.length)
        array[index] = asInteger ? Math.trunc(add ? array[index] + value : value) : add ? array[index] + value : value;
    };
    for (const key in controller.params) {
      const match = key.match(/^(var|fvar|sysvar|sysfvar)\s*\((.*)\)$/i);
      if (!match) continue;
      const kind = match[1].toLowerCase(),
        index = MG.compile(match[2]).f(this) | 0,
        value = this.n(controller, key, 0, 0);
      put(
        kind === 'var'
          ? targetFighter.vars
          : kind === 'fvar'
            ? targetFighter.fvars
            : kind === 'sysvar'
              ? targetFighter.sysvars
              : targetFighter.sysfvars,
        index,
        value,
        kind === 'var' || kind === 'sysvar'
      );
    }
    if (this.has(controller, 'v'))
      put(targetFighter.vars, this.n(controller, 'v') | 0, this.n(controller, 'value', 0, 0), true);
    if (this.has(controller, 'fv'))
      put(targetFighter.fvars, this.n(controller, 'fv') | 0, this.n(controller, 'value', 0, 0), false);
  },
  /**
   * BindToParent: follow the parent at an offset for some ticks (helpers only).
   * @param {object} controller parsed controller
   */
  bindtoparent(controller) {
    if (this.isHelper)
      this.hBind = {
        to: this.parent,
        t: this.n(controller, 'time', 0, 1),
        x: this.n(controller, 'pos', 0, 0),
        y: this.n(controller, 'pos', 1, 0),
        facing: this.n(controller, 'facing', 0, 0)
      };
  },
  /**
   * BindToRoot: follow the root player at an offset for some ticks (helpers only).
   * @param {object} controller parsed controller
   */
  bindtoroot(controller) {
    if (this.isHelper)
      this.hBind = {
        to: this.root,
        t: this.n(controller, 'time', 0, 1),
        x: this.n(controller, 'pos', 0, 0),
        y: this.n(controller, 'pos', 1, 0),
        facing: this.n(controller, 'facing', 0, 0)
      };
  },
  /**
   * AttackDist: distance at which the opponent starts guarding this attack (value is in 240p units).
   * @param {object} controller parsed controller
   */
  attackdist(controller) {
    this.atkDist = this.n(controller, 'value', 0, 0) * this.k240;
  }
};
