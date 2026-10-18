/* =====================================================================
   MugenFighter: one fighter's state machine (states, controllers, hit
   state mapping), physics and basic actions. Input history and command
   recognition are inherited from FighterInput (fighter-input.js).
   One call to update() is one 60 Hz tick.

   Key MUGEN concepts used here:
   - statedef: a numbered state of the character's .cns/.cmd files. It sets
     type (S stand / C crouch / A air / L lying), movetype (I idle / A attack /
     H being hit), physics, animation, velocity and ctrl (can the player act).
   - controller: a state controller inside a statedef; it runs when its
     triggers (trigger1.., triggerall) are true. Controllers live in MCTL.
   - ctrl: flag allowing hard-wired actions (walk, jump, guard) and commands.
   - hitdef: the armed attack of the fighter; getHit holds the data of the
     last hit received (see newGetHit).
   - juggle: points limiting how many extra hits a falling opponent can take.
   - helper / explod / projectile: extra entities owned by the fighter.
   - Negative states -1, -2, -3 run every tick before the current state.
   Coordinates: posX/posY are in the character's own localcoord units (y up is
   negative); the x/y/wx/wy getters give game pixels (see `s` below).
   ===================================================================== */

/**
 * MUGEN truthiness of a trigger result: numbers are true when non-zero and not NaN.
 * @param {*} value evaluated expression result
 * @returns {boolean}
 */
const truthy = value => (typeof value === 'number' ? value !== 0 && !isNaN(value) : !!value && value !== '');

/**
 * Trims a parameter and strips one pair of surrounding double quotes.
 * @param {string} text raw parameter text
 * @returns {string}
 */
const unquoteText = text => (text || '').trim().replace(/^"(.*)"$/, '$1');

/**
 * Compiles (once, cached on the controller as `_p`) the trigger expressions of a controller.
 * `all` are the triggerall conditions; each group is one triggerN set (all its conditions must hold; any group may fire).
 * @param {object} controller parsed state controller
 * @returns {{all: object[], groups: object[][]}} compiled expressions
 */
function prep(controller) {
  if (controller._p) return controller._p;
  const compiled = {
    all: controller.all.map(source => MG.compile(source)),
    groups: Object.keys(controller.groups)
      .map(Number)
      .sort((a, b) => a - b)
      .map(groupNumber => controller.groups[groupNumber].map(source => MG.compile(source)))
  };
  return (controller._p = compiled);
}

/** A player (or, through MugenHelper, a helper): state machine, physics and hard-wired basic actions. */
class MugenFighter extends FighterInput {
  /**
   * @param {object} character game character record; `character.mugen` is its loaded package (states, air, consts, commands)
   * @param {number} idx player index (0 = P1, 1 = P2)
   * @param {?function} inputFn returns this tick's raw input for the fighter, or null for no input (helpers)
   * @param {number} [palSlot] palette slot (defaults to 1)
   */
  constructor(character, idx, inputFn, palSlot) {
    super();
    this.mugen = true;
    this.ch = character;
    this.pkg = character.mugen;
    this.idx = idx;
    this.inputFn = inputFn;
    this.palSlot = palSlot || 1;
    this.name = this.pkg.name;
    // s: game pixels per character unit (stage height 540 / the character's localcoord height).
    this.s = 540 / ((this.pkg.local && this.pkg.local[1]) || 240);
    // k240: factor converting 240p default constants to this character's localcoord.
    this.k240 = 540 / this.s / 240;
    this.wins = 0;
    this.meter = 0;
    this.aiLevel = 0;
    this.reset(0, 1);
  }
  /* ---------- game-facing coordinate adapters (pixels, y up) ---------- */
  /** Horizontal position in stage pixels. */
  get x() {
    return STAGE_W / 2 + this.posX * this.s;
  }
  set x(pixels) {
    this.posX = (pixels - STAGE_W / 2) / this.s;
  }
  /** Vertical position in pixels, measured upwards from the floor (negative of MUGEN's posY). */
  get y() {
    return -this.posY * this.s;
  }
  set y(pixels) {
    this.posY = -pixels / this.s;
  }
  /** World x in pixels (same as x). */
  get wx() {
    return this.x;
  }
  /** World y in pixels, in MUGEN orientation (negative when above the floor). */
  get wy() {
    return this.posY * this.s;
  }
  /** Alias of life, for the game-side HUD code. */
  get hp() {
    return this.life;
  }
  set hp(value) {
    this.life = value;
  }
  /** Alias of stateno. */
  get st() {
    return this.stateno;
  }
  /** True while lying on the ground (state type L). */
  get down() {
    return this.type === 'L';
  }
  /** Alias of time (ticks in the current state). */
  get stt() {
    return this.time;
  }
  /** Remaining get-hit time of the current hit. */
  get hitTime() {
    return this.getHit.hittime;
  }

  /**
   * Resets the fighter for a new round and enters the pre-round state 5900.
   * @param {number} x start position in stage pixels
   * @param {number} face initial facing (1 right, -1 left)
   */
  reset(x, face) {
    const constant = name => this.const(name);
    this.life = this.maxHp = constant('data.life');
    this.power = 0;
    this.powerMax = constant('data.power') || 3000;
    this.posX = (x - STAGE_W / 2) / this.s;
    this.posY = 0;
    this.velX = 0;
    this.velY = 0;
    this.face = face || 1;
    // MUGEN variables: var(0..59)/fvar(0..59) for the character, sysvar/sysfvar (5 each) for the engine/system use.
    this.vars = new Array(60).fill(0);
    this.fvars = new Array(60).fill(0);
    this.sysvars = new Array(5).fill(0);
    this.sysfvars = new Array(5).fill(0);
    this.time = 0;
    this.stateno = 0;
    this.prevStateno = 0;
    this.type = 'S';
    this.movetype = 'I';
    this.physics = 'S';
    this.ctrl = false;
    this.stOwner = this.pkg; // package whose states are being run (changes with a foreign state taken from the opponent)
    this.animation = new MAnim(this.pkg);
    this.animation.set(0);
    this.dh = [];
    this.bh = [];
    this.cmdOn = {};
    this.force = {};
    this.hold = { B: 0, F: 0, U: 0, D: 0 };
    this.upPrev = false;
    this.hitPause = 0;
    this.hitdef = null;
    this.getHit = this.newGetHit();
    this.target = null;
    this.bound = 0;
    this.bindT = null;
    this.moveContact = this.moveHit = this.moveGuarded = false;
    this.hitCount = 0;
    this.juggleReq = 0;
    this.juggleLeft = constant('data.airjuggle');
    this.hitby = [null, null];
    this.asf = new Set();
    this.pers = new Map(); // persistent-controller counters of the current state
    this.persNeg = new Map();
    this.explods = [];
    this.projs = [];
    this.pcontact = {};
    this.defMul = 1;
    this.atkMul = 1;
    this.posFreeze = false;
    this.widthOv = null;
    this.tickN = 0;
    this.airJumps = 0;
    this.combo = 0;
    this.comboShow = 0;
    this.comboHits = 0;
    this.comboDmg = 0;
    this.dmgTaken = 0;
    this.won = false;
    this.koSent = false;
    this.glow = 0;
    this.inv = 0;
    this.shakeX = 0;
    this.helpers = [];
    this.root = this;
    this.parent = null;
    this.isHelper = false;
    this.uid = this.idx + 1;
    this.atkDist = null;
    this.hBind = null;
    this.fightOn = false;
    this._wdKey = '';
    this._wdN = 0;
    this.sprPri = 0;
    this.hurtT = 0;
    this.trans = null;
    this.pausedMove = 0;
    this._idle = 0;
    this.stateChanged = false;
    this.curState = null;
    this.noScreenBound = false;
    this.changeState(5900); // intro/pre-round state of the standard common states
  }
  /** Creates a fresh, empty get-hit record (the data of the last hit received: times, velocities, fall state, hit ids). */
  newGetHit() {
    return {
      pending: false,
      hitshaketime: 0,
      hittime: 0,
      slidetime: 0,
      ctrltime: 0,
      xvel: 0,
      yvel: 0,
      xaccel: 0,
      yaccel: 0,
      animtype: 0,
      groundtype: 1,
      airtype: 1,
      type: 1,
      fall: 0,
      fallcount: 0,
      fallTime: 0,
      'fall.xvel': 0,
      'fall.yvel': 0,
      'fall.recover': 1,
      'fall.recovertime': 4,
      'fall.damage': 0,
      'fall.kill': 1,
      'fall.xvelset': false,
      guarded: 0,
      damage: 0,
      hitcount: 0,
      guardcount: 0,
      id: 0,
      hitid: 0,
      chainid: -1,
      down: 0,
      downRecover: 0,
      downRecoverTime: 0,
      facing: 0,
      forcestand: 0,
      forcecrouch: 0,
      p2getp1state: 0,
      keepstate: 0,
      guardko: 0,
      hitDef: null,
      by: null
    };
  }
  /* ---------- constants ---------- */
  /**
   * Looks up a character constant (.cns [Data]/[Size]/[Velocity]/[Movement]) with fallbacks to engine defaults.
   * Order: the character's own value, the default (scaled to localcoord unless unitless), an alias name, then a
   * ".x/.y/.z" component of a vector constant. Returns 0 when nothing is found.
   * @param {string} key lower-case constant name, e.g. 'velocity.walk.fwd'
   * @returns {number}
   */
  const(key) {
    const consts = this.pkg.consts;
    let values = consts[key];
    if (values && values.length) return values[0];
    const scaleFor = name => (MD_UNITLESS.test(name) ? 1 : this.k240);
    if (MD[key]) return MD[key][0] * scaleFor(key);
    const alias = MD_ALIAS[key];
    if (alias) {
      values = consts[alias[0]];
      if (values && values.length > alias[1]) return values[alias[1]];
      if (MD[alias[0]]) return MD[alias[0]][alias[1]] * scaleFor(alias[0]);
    }
    const axisMatch = key.match(/^(.*)\.([xyz])$/);
    if (axisMatch) {
      const axisIndex = 'xyz'.indexOf(axisMatch[2]);
      values = consts[axisMatch[1]];
      if (values && values.length > axisIndex) return values[axisIndex];
      if (MD[axisMatch[1]] && MD[axisMatch[1]].length > axisIndex)
        return MD[axisMatch[1]][axisIndex] * scaleFor(axisMatch[1]);
    }
    return 0;
  }
  /**
   * Reads a two-component constant stored as "<key>.x" and "<key>.y".
   * @param {string} key constant base name
   * @returns {number[]} [x, y]
   */
  constPair(key) {
    return [this.const(key + '.x'), this.const(key + '.y')];
  }
  /* ---------- geometry ---------- */
  /**
   * P2Dist X style distance: horizontal distance to another entity in own units, positive in front of the facing.
   * @param {MugenFighter} other
   * @returns {number}
   */
  distX(other) {
    return ((other.x - this.x) * this.face) / this.s;
  }
  /**
   * Vertical distance to another entity in own units (positive when the other is lower on screen).
   * @param {MugenFighter} other
   * @returns {number}
   */
  distY(other) {
    return (other.posY * other.s - this.posY * this.s) / this.s;
  }
  /** Width of the body in front of the origin (size.*.front, air or ground depending on the state type) unless overridden by Width. */
  frontW() {
    return this.widthOv ? this.widthOv[0] : this.const(this.type === 'A' ? 'size.air.front' : 'size.ground.front');
  }
  /** Width of the body behind the origin (size.*.back), unless overridden by Width. */
  backW() {
    return this.widthOv ? this.widthOv[1] : this.const(this.type === 'A' ? 'size.air.back' : 'size.ground.back');
  }
  /**
   * FrontEdgeDist / BackEdgeDist / FrontEdgeBodyDist / BackEdgeBodyDist: distance to the visible screen edge.
   * @param {boolean} front true for the edge the fighter faces, false for the one behind
   * @param {boolean} body true to subtract the body width (the *BodyDist triggers)
   * @returns {number} distance in own units
   */
  edgeDist(front, body) {
    const left = G.cam.x,
      right = G.cam.x + W,
      face = this.face;
    const toRight = (right - this.x) / this.s,
      toLeft = (this.x - left) / this.s;
    let distance = front === face > 0 ? toRight : toLeft;
    if (body) distance -= front ? this.frontW() : this.backW();
    return distance;
  }
  /**
   * Is an incoming attack (opponent or its helpers' armed hitdef, or a projectile) close enough to warrant guarding?
   * Used by the hard-wired guard: holding back near an attack enters the guard state.
   * @returns {boolean}
   */
  inGuardDist() {
    const opponent = this.opponent;
    if (!opponent) return false;
    for (const attacker of [opponent, ...opponent.helpers]) {
      if (attacker.hitdef && attacker.movetype === 'A' && !attacker.hitdef.done && !attacker.hitdef.rev) {
        const distance = Math.abs(attacker.x - this.x) / attacker.s;
        // atkDist is set by the attacker's own state (size.attack.dist override); otherwise use the hitdef's guard.dist.
        if (
          distance <= (attacker.atkDist !== null ? attacker.atkDist : attacker.hitdef.guardDist || 160 * attacker.k240)
        )
          return true;
      }
      for (const projectile of attacker.projs)
        if (!projectile.dead && projectile.hitDef && !projectile.done) {
          const distance = Math.abs(projectile.wx - this.x) / attacker.s;
          if (distance <= (projectile.hitDef.guardDist || 90 * attacker.k240)) return true;
        }
    }
    return false;
  }
  /* ---------- animation helpers used by triggers ---------- */
  /** AnimTime trigger. */
  animTime() {
    return this.animation.animTime();
  }
  /**
   * AnimElemTime trigger.
   * @param {number} elementNumber 1-based element
   */
  animElemTime(elementNumber) {
    return this.animation.elemTime(elementNumber);
  }
  /**
   * AnimElemNo trigger.
   * @param {number} rel relative offset argument
   */
  animElemNo(rel) {
    return this.animation.elemNo(rel);
  }
  /**
   * AnimExist trigger: does the fighter's own package have this action?
   * @param {number} animNumber
   * @param {*} [foreign] unused
   */
  animExist(animNumber, foreign) {
    return this.pkg.air.has(animNumber);
  }
  /**
   * SelfAnimExist trigger: checks the package that owns the running state, then the own package.
   * @param {number} animNumber
   */
  selfAnimExist(animNumber) {
    return (this.stOwner || this.pkg).air.has(animNumber) || this.pkg.air.has(animNumber);
  }
  /** Current animation (action) number. */
  get animNo() {
    return this.animation.no;
  }
  /**
   * Switches the animation (ChangeAnim).
   * @param {number} animNumber action number
   * @param {number} [elementIndex] element to start at
   * @param {object} [pkg] package providing the action (defaults to own)
   * @returns {boolean} false if the action does not exist
   */
  changeAnim(animNumber, elementIndex, pkg) {
    return this.animation.set(animNumber, elementIndex || 0, pkg || this.pkg);
  }
  /**
   * ProjContactTime / ProjHitTime / ProjGuardedTime: ticks since the last contact of a projectile id.
   * @param {number} id projectile id
   * @param {string} kind 'hit', 'guard', or anything else for any contact
   * @returns {number} ticks since the contact, or -1 when there was none of that kind
   */
  projContactTime(id, kind) {
    const contact = this.pcontact[id];
    if (!contact) return -1;
    if (kind === 'hit' && contact.kind !== 'hit') return -1;
    if (kind === 'guard' && contact.kind !== 'guard') return -1;
    return this.tickN - contact.t;
  }

  /* ---------- states ---------- */
  /**
   * Finds a statedef by number: the owner's states, its common states, the own package, then the engine's common states.
   * @param {number} stateNumber
   * @param {object} [owner] package to search first (defaults to the current state owner)
   * @returns {?object} parsed statedef or null
   */
  getState(stateNumber, owner) {
    const searchFirst = owner || this.stOwner || this.pkg;
    return (
      searchFirst.states.get(stateNumber) ||
      (searchFirst.common && searchFirst.common.get(stateNumber)) ||
      this.pkg.states.get(stateNumber) ||
      (this.pkg.common && this.pkg.common.get(stateNumber)) ||
      commonStates().get(stateNumber) ||
      null
    );
  }
  /**
   * Evaluates one component of a statedef parameter (e.g. velset's y), compiling the expressions lazily.
   * @param {object} stateDef parsed statedef
   * @param {string} key parameter name
   * @param {number} index component index within the comma list
   * @param {*} fallback value when the parameter or component is missing or not numeric
   * @returns {*}
   */
  sdExpr(stateDef, key, index, fallback) {
    const raw = stateDef.params[key];
    if (raw === undefined) return fallback;
    stateDef._l = stateDef._l || {};
    const list = stateDef._l[key] || (stateDef._l[key] = MG.compileList(raw));
    if (!list[index]) return fallback;
    const value = list[index].f(this);
    return typeof value === 'number' ? value : fallback;
  }
  /**
   * Enters a statedef (ChangeState / SelfState): resets state time and persistence and applies the statedef header
   * parameters (type, movetype, physics, anim, ctrl, velset, poweradd, juggle, sprpriority and the *persist flags).
   * Falls back to state 0 when the state does not exist.
   * @param {number} stateNumber
   * @param {object} [owner] package that owns the state (a foreign state, e.g. taken from the opponent)
   */
  changeState(stateNumber, owner) {
    const stateDef = this.getState(stateNumber, owner || this.stOwner);
    if (!stateDef) {
      MG.warn('Missing state ' + stateNumber + ' (' + this.name + ')');
      if (stateNumber !== 0) this.changeState(0);
      return;
    }
    if (owner) this.stOwner = owner;
    if (stateNumber === 0 && (this.stateno === 190 || this.stateno === 191) && G.phase === 'fight') this.ctrl = true;
    (this.hist || (this.hist = [])).push(stateNumber);
    if (this.hist.length > 10) this.hist.shift(); /* last states, for diagnostics */
    this.atkDist = null;
    this.prevStateno = this.stateno;
    this.stateno = stateNumber;
    this.time = 0;
    this.pers = new Map();
    this.stateChanged = true;
    this.curState = stateDef;
    const params = stateDef.params,
      firstLetter = key => (params[key] || '').trim().toUpperCase()[0];
    let letter;
    if ((letter = firstLetter('type')) && 'SCAL'.indexOf(letter) >= 0) this.type = letter;
    if ((letter = firstLetter('movetype')) && 'IAH'.indexOf(letter) >= 0) this.movetype = letter;
    if ((letter = firstLetter('physics')) && 'SCAN'.indexOf(letter) >= 0) this.physics = letter;
    if (
      params.facep2 !== undefined &&
      this.sdExpr(stateDef, 'facep2', 0, 0) &&
      this.opponent &&
      this.distX(this.opponent) < 0
    )
      this.face = -this.face;
    if (params.anim !== undefined) {
      const animNumber = this.sdExpr(stateDef, 'anim', 0, null);
      if (animNumber !== null) this.changeAnim(animNumber | 0);
    }
    if (params.ctrl !== undefined) this.ctrl = !!this.sdExpr(stateDef, 'ctrl', 0, 0);
    if (params.velset !== undefined) {
      this.velX = this.sdExpr(stateDef, 'velset', 0, this.velX);
      this.velY = this.sdExpr(stateDef, 'velset', 1, this.velY);
    }
    if (params.poweradd !== undefined) this.addPower(this.sdExpr(stateDef, 'poweradd', 0, 0));
    this.juggleReq = params.juggle !== undefined ? this.sdExpr(stateDef, 'juggle', 0, 0) : 0;
    if (params.sprpriority !== undefined) this.sprPri = this.sdExpr(stateDef, 'sprpriority', 0, 0);
    // The move-contact flags and hit count reset on every state change unless the statedef asks to keep them.
    if (!(params.movehitpersist !== undefined && this.sdExpr(stateDef, 'movehitpersist', 0, 0))) {
      this.moveContact = this.moveHit = this.moveGuarded = false;
    }
    if (!(params.hitcountpersist !== undefined && this.sdExpr(stateDef, 'hitcountpersist', 0, 0))) this.hitCount = 0;
    if (!(params.hitdefpersist !== undefined && this.sdExpr(stateDef, 'hitdefpersist', 0, 0))) this.hitdef = null;
  }
  /**
   * Adds to the power bar, clamped to [0, powerMax].
   * @param {number} amount may be negative
   */
  addPower(amount) {
    this.power = Math.max(0, Math.min(this.powerMax, this.power + amount));
  }

  /**
   * Returns the compiled comma-separated expression list of a controller parameter (cached), or null if absent.
   * @param {object} controller state controller
   * @param {string} key parameter name
   * @returns {?object[]}
   */
  L(controller, key) {
    controller._l = controller._l || {};
    let list = controller._l[key];
    if (list === undefined) {
      const raw = controller.params[key];
      list = controller._l[key] = raw === undefined ? null : MG.compileList(raw);
    }
    return list;
  }
  /**
   * Evaluates a numeric controller parameter component.
   * @param {object} controller state controller
   * @param {string} key parameter name
   * @param {number} [index] component index
   * @param {number} [fallback] value when missing or NaN
   * @returns {number}
   */
  n(controller, key, index = 0, fallback = 0) {
    const list = this.L(controller, key);
    if (!list || !list[index]) return fallback;
    const value = list[index].f(this);
    return typeof value === 'number'
      ? isNaN(value)
        ? fallback
        : value
      : typeof value === 'string'
        ? fallback
        : +value || 0;
  }
  /**
   * Is the parameter present on the controller?
   * @param {object} controller state controller
   * @param {string} key parameter name
   * @returns {boolean}
   */
  has(controller, key) {
    return controller.params[key] !== undefined;
  }
  /**
   * Returns a parameter as an unquoted string (not evaluated).
   * @param {object} controller state controller
   * @param {string} key parameter name
   * @param {string} [fallback] value when missing
   * @returns {string}
   */
  raw(controller, key, fallback = '') {
    const value = controller.params[key];
    return value === undefined ? fallback : unquoteText(value);
  }

  /**
   * Decides whether a controller fires this tick: triggerall AND at least one triggerN group, then the
   * `persistent` rule (1 = every tick, 0 = once per state entry, N = once every N ticks).
   * @param {object} controller state controller
   * @param {boolean} negative true when running the negative states (-1..-3), which keep a separate counter map
   * @returns {boolean}
   */
  fires(controller, negative) {
    try {
      const compiled = prep(controller);
      for (const trigger of compiled.all) if (!truthy(trigger.f(this))) return false;
      let anyGroupTrue = false;
      for (const group of compiled.groups) {
        let groupTrue = true;
        for (const trigger of group)
          if (!truthy(trigger.f(this))) {
            groupTrue = false;
            break;
          }
        if (groupTrue) {
          anyGroupTrue = true;
          break;
        }
      }
      if (!anyGroupTrue) return false;
      if (controller.persistent !== 1) {
        const counters = negative ? this.persNeg : this.pers;
        const remaining = counters.get(controller) || 0;
        if (remaining > 0) {
          if (isFinite(remaining)) counters.set(controller, remaining - 1);
          return false;
        }
        counters.set(controller, controller.persistent === 0 ? Infinity : controller.persistent - 1);
      }
      return true;
    } catch (error) {
      MG.warn('Trigger error in ' + this.name + ' state ' + this.stateno + ': ' + error.message);
      return false;
    }
  }
  /**
   * Runs the controllers of one statedef in order; stops as soon as a controller changes the state.
   * @param {?object} stateDef statedef to run
   * @param {boolean} paused true during hit pause: only controllers with ignorehitpause run
   * @param {boolean} negative true for negative states
   */
  runList(stateDef, paused, negative) {
    if (!stateDef) return;
    for (const controller of stateDef.ctrls) {
      if (paused && !controller.ignorehp) continue;
      if (!this.fires(controller, negative)) continue;
      const handler = MCTL[controller.type];
      if (!handler) {
        if (!MQUIET.has(controller.type)) MG.warn('Unsupported state controller: ' + controller.type);
        continue;
      }
      try {
        handler.call(this, controller);
      } catch (error) {
        MG.warn('Controller ' + controller.type + ' failed: ' + error.message);
      }
      if (this.stateChanged) return;
    }
  }
  /**
   * Runs states -3, -2, -1 (always executed first) and then the current state; if the current state
   * changes state, the new one runs immediately (up to 12 chained changes per tick).
   * @param {boolean} paused true during hit pause
   */
  runStates(paused) {
    for (const stateNumber of [-3, -2, -1]) {
      const stateDef = this.pkg.states.get(stateNumber);
      if (stateDef) {
        this.stateChanged = false;
        this.runList(stateDef, paused, true);
      }
    }
    for (let loops = 0; loops < 12; loops++) {
      this.stateChanged = false;
      this.runList(this.curState, paused, false);
      if (!this.stateChanged) break;
    }
  }

  /**
   * Hard-wired basic actions (guard, jump, air jump, crouch, stand up, walk) that MUGEN performs when the
   * player has ctrl; each simply changes to the standard common state (120 guard, 40 jump, 45 air jump, 10 crouch,
   * 12 stand, 20 walk). The nohardcodedkeys / nojump / ... assert-specials disable them.
   */
  basicActions() {
    const hold = this.hold,
      stateNumber = this.stateno;
    if (this.ctrl && !this.asf.has('nohardcodedkeys')) {
      const stateType = this.type;
      if (hold.B && this.inGuardDist() && !this.inGuardState() && stateType !== 'L' && this.movetype === 'I')
        this.changeState(120);
      else if (stateType === 'S' && hold.U && stateNumber !== 40 && !this.asf.has('nojump')) this.changeState(40);
      else if (
        stateType === 'A' &&
        hold.U &&
        !this.upPrev &&
        this.airJumps < this.const('movement.airjump.num') &&
        this.posY <= -this.const('movement.airjump.height') &&
        !this.asf.has('noairjump')
      ) {
        this.airJumps++;
        this.changeState(45);
      } else if (stateType === 'S' && hold.D && stateNumber !== 10 && !this.asf.has('nocrouch')) {
        if (stateNumber !== 100) this.velX = 0;
        this.changeState(10);
      } else if (stateType === 'C' && !hold.D && stateNumber !== 12 && !this.asf.has('nostand')) this.changeState(12);
      else if (
        stateType === 'S' &&
        stateNumber !== 20 &&
        !this.asf.has('nowalk') &&
        (hold.F ? 1 : 0) !== (hold.B && !this.inGuardDist() ? 1 : 0)
      )
        this.changeState(20);
    }
    if (stateNumber === 20 && !!hold.B === !!hold.F && !this.asf.has('nobrake')) this.changeState(0);
    this.upPrev = !!hold.U;
    if (this.type !== 'A') this.airJumps = 0;
  }
  /** Is the fighter in a guard state (120-155)? */
  inGuardState() {
    const stateNumber = this.stateno;
    return stateNumber >= 120 && stateNumber <= 155;
  }
  /** Turns to face the opponent when idle on the ground (unless assert-special noautoturn), playing the turn animation 5 or 6. */
  autoTurn() {
    const opponent = this.opponent;
    if (!opponent || this.asf.has('noautoturn')) return;
    if (
      (this.type === 'S' || this.type === 'C') &&
      this.movetype === 'I' &&
      (this.physics === 'S' || this.physics === 'C') &&
      (this.ctrl || this.stateno === 52) &&
      !this.inGuardState()
    ) {
      if (this.distX(opponent) < 0 && Math.abs(opponent.x - this.x) > 4) {
        this.face = -this.face;
        if (this.stateno === 0 && this.pkg.air.has(5)) this.changeAnim(5);
        else if (this.stateno === 11 && this.pkg.air.has(6)) this.changeAnim(6);
      }
    }
  }

  /* ---------- the hit → get-hit state mapping (engine side) ---------- */
  /**
   * Enters the right get-hit state for a pending hit: 150/152/154 when guarding (stand/crouch/air),
   * 5080 when already lying on the ground, 5070 for a trip, otherwise 5000 (standing), 5010 (crouching) or
   * 5020 (in the air). The victim always runs its own states.
   */
  enterGetHit() {
    const getHit = this.getHit;
    getHit.pending = false;
    this.movetype = 'H';
    this.hitPause = 0;
    this.ctrl = false;
    this.hitdef = this.hitdef && this.hitdef.keepOnHit ? this.hitdef : null;
    // The victim always runs its OWN get-hit states; p2getp1state only matters for an explicit p2stateno (world.js).
    this.stOwner = this.pkg;
    const stateType = this.type;
    if (getHit.guarded && !getHit.guardko) {
      this.changeState(stateType === 'S' ? 150 : stateType === 'C' ? 152 : 154, this.pkg);
      return;
    }
    if (stateType === 'L' && this.posY >= -1) {
      this.changeState(5080);
      return;
    }
    if (getHit.groundtype === 3) {
      this.changeState(5070);
      return;
    }
    if (getHit.forcestand && stateType === 'C') this.type = 'S';
    else if (getHit.forcecrouch && stateType === 'S') this.type = 'C';
    if (this.type === 'S') this.changeState(5000);
    else if (this.type === 'C') this.changeState(this.life <= 0 ? 5000 : 5010);
    else this.changeState(5020);
  }

  /* ---------- one 60 Hz tick ---------- */
  /**
   * Advances the fighter by one 60 Hz tick: input, get-hit entry, hard-wired actions, state controllers
   * (skipped except ignorehitpause ones during hit pause), engine-side state transitions, physics, animation.
   */
  update() {
    this.tickN++;
    if (this.isHelper) this.fightOn = true;
    else if (G.phase === 'fight') {
      if (!this.fightOn) {
        this.fightOn = true;
        if (this.life > 0) {
          if (this.stateno === 190 || this.stateno === 191 || this.stateno === 5900) this.changeState(0);
          this.ctrl = true;
        }
      }
    } else this.fightOn = false;
    this.readInput();
    this.asf.clear();
    this.widthOv = null;
    if (this.glow > 0) this.glow--;
    if (this.inv > 0) this.inv--;
    let paused = this.hitPause > 0;
    if (this.pausedMove > 0) {
      this.pausedMove--;
      paused = false;
    }
    if (!paused) {
      // Expire the two HitBy/NotHitBy slots.
      for (let i = 0; i < 2; i++) {
        const slot = this.hitby[i];
        if (slot && --slot.time <= 0) this.hitby[i] = null;
      }
      if (!this.isHelper) {
        if (this.getHit.pending) this.enterGetHit();
        this.basicActions();
        this.autoTurn();
      }
    }
    this.runStates(paused);
    if (paused) {
      if (this.hitPause > 0) this.hitPause--;
      this.endTick(true);
      return;
    }
    /* engine-side transitions: the new state must run its time-0 controllers right away (e.g. "ChangeAnim, time = 0" that picks the get-up anim),
       otherwise they would never see time 0 and the fighter stays frozen in the old animation */
    if (
      !this.isHelper &&
      this.stateno === 5110 &&
      this.time >= 1 &&
      this.getHit.downRecoverTime <= 0 &&
      this.life > 0
    ) {
      this.changeState(5120);
      this.runList(this.curState, false, false);
    }
    for (
      let attempt = 0;
      !this.isHelper &&
      this.stateno === 140 &&
      (!this.animation.act || this.time >= this.animation.total) &&
      attempt < 3;
      attempt++
    ) {
      this.changeState(this.type === 'C' ? 11 : this.type === 'A' ? 51 : 0);
      this.runList(this.curState, false, false);
    }
    this.doPhysics();
    this.animation.tick();
    this.time++;
    if (!this.isHelper) this.watchdog();
    this.endTick(false);
    if (MG.trace) MG.trace(this);
  }
  /**
   * Safety net for characters that rely on engine features we lack: an animation that stops advancing, or a fighter left in a
     get-hit state with nothing that will ever end it, is reported once and unstuck instead of freezing for the rest of the round.
   */
  watchdog() {
    const anim = this.animation,
      key = anim.no + '/' + anim.elem + '/' + anim.etime + '/' + anim.time;
    if (key === this._wdKey && anim.act && anim.act.frames.length > 1 && !anim.act.inf && !Mugen.pause) {
      if (++this._wdN === 30) {
        MG.warn(
          'Animation ' +
            anim.no +
            ' stopped advancing in state ' +
            this.stateno +
            ' (' +
            this.name +
            '); skipped to its next frame'
        );
        anim.elem = (anim.elem + 1) % anim.act.frames.length;
        anim.etime = 0;
        this._wdN = 0;
      }
    } else {
      this._wdKey = key;
      this._wdN = 0;
    }
    const hitState =
      this.stateno >= 5000 && this.stateno < 6000 && this.stateno !== 5110 && this.stateno !== 5150 && this.life > 0;
    if (hitState && this.time > 400 && G.phase === 'fight') {
      MG.warn(
        'State ' +
          this.stateno +
          ' lasted too long (' +
          this.name +
          ', came from ' +
          (this.hist || []).join('>') +
          '); returned to idle'
      );
      this.type = this.posY < 0 ? 'A' : 'S';
      this.changeState(this.type === 'A' ? 51 : 0);
      this.ctrl = this.type === 'S';
    }
  }
  /**
   * End-of-tick bookkeeping: counts down hit-shake/get-hit timers, clears combo state once no longer being hit,
   * and refreshes the shake offset, life cap and power meter percentage.
   * @param {boolean} paused true when the tick was a hit-pause tick (timers then do not advance)
   */
  endTick(paused) {
    const getHit = this.getHit;
    if (!paused) {
      if (this.movetype === 'H') {
        if (getHit.hitshaketime > 0) getHit.hitshaketime--;
        if (getHit.fall) getHit.fallTime++;
      } else if (!getHit.pending) {
        getHit.hitshaketime = 0;
        getHit.fall = 0;
        getHit.fallcount = 0;
        getHit.fallTime = 0;
        getHit.guardcount = 0;
        getHit.hitcount = 0;
        this.combo = 0;
        this.juggleLeft = this.const('data.airjuggle');
        this.defMul = 1;
      }
      if (getHit.hitshaketime <= 0 && getHit.hittime >= 0) getHit.hittime--;
      if (getHit.downRecoverTime > 0 && this.stateno === 5110) getHit.downRecoverTime--;
    }
    this.shakeX = getHit.hitshaketime > 0 && this.time & 1 ? 1 : 0;
    if (this.life > this.maxHp) this.life = this.maxHp;
    this.meter = (this.power / this.powerMax) * 100;
  }
  /**
   * Applies velocity to position, then the physics type: S (stand) and C (crouch) apply friction and snap to the
   * floor; A (air) applies gravity and lands (state 52) when reaching the floor; N does nothing.
   */
  doPhysics() {
    const physics = this.physics;
    if (!this.posFreeze) {
      this.posX += this.velX * this.face;
      this.posY += this.velY;
    }
    this.posFreeze = false;
    /* S/C physics ground the fighter, but only a ground-type state: some fighters force "physics = S" on an air-type state
       that is still falling (e.g. Kenshiro's recover state 5200), and snapping it to the floor would leave it there forever */
    const onGround = this.type !== 'A';
    if (physics === 'S') {
      this.velX *= this.const('movement.stand.friction');
      if (Math.abs(this.velX) < 0.05 * this.k240) this.velX = 0;
      if (onGround) {
        this.posY = 0;
        this.velY = 0;
      }
    } else if (physics === 'C') {
      this.velX *= this.const('movement.crouch.friction');
      if (onGround) {
        this.posY = 0;
        this.velY = 0;
      }
    } else if (physics === 'A') {
      this.velY += this.const('movement.yaccel');
      if (this.velY > 0 && this.posY >= 0 && this.stateno !== 105 && !this.isHelper) {
        this.changeState(52);
      }
    }
  }
}
