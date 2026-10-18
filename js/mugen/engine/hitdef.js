/* =====================================================================
   HitDef parsing: hit attributes, flags and the full HitDef/ReversalDef
   parameter set, evaluated into a plain object when the controller fires.

   Key concepts:
   - A HitDef is the MUGEN controller that arms an attack: it describes the
     damage, hit/guard pause, sparks, sounds, velocities, fall behaviour,
     state changes forced on the victim, etc. It stays active until it hits,
     is replaced or the state changes (unless hitdefpersist is set).
   - A ReversalDef is a HitDef-like controller that turns an incoming attack
     around (a counter move); it uses the same parameters plus reversal.attr.
   - A hit "attribute" is a string such as "S, NA": the first part is the
     state type (S stand, C crouch, A air) and the rest are attack types
     (N normal, S special, H hyper, each followed by A attack, T throw,
     P projectile).
   ===================================================================== */

/** Animation type names (hit reaction animation) -> numeric code; 0 light, 1 medium, 2 hard, 3 back, 4 up, 5 diag-up. */
const MANIM = { light: 0, medium: 1, hard: 2, back: 3, up: 4, diagup: 5, 'diag-up': 5 };
/** Hit type names (ground.type / air.type) -> numeric code. */
const MHT = { none: 0, high: 1, low: 2, trip: 3 };

/**
 * Parses a hit attribute string such as "S, NA" into its state type and attack types.
 * @param {string} raw attribute text from the HitDef (may be empty)
 * @returns {{st: string, types: string[]}} state-type letters (S/C/A) and attack-type codes (NA, SP, HT ...)
 */
function parseAttr(raw) {
  const parts = (raw || '').split(',').map(part => part.trim().toUpperCase());
  return { st: parts[0] || '', types: parts.slice(1).filter(Boolean) };
}

/**
 * Tells whether a hit attribute satisfies a filter (an empty part of the filter matches anything).
 * @param {{st: string, types: string[]}} filter attribute pattern, as returned by parseAttr
 * @param {{st: string, types: string[]}} attr the attack's attribute
 * @returns {boolean}
 */
function matchAttr(filter, attr) {
  const stateTypeOk = !filter.st || [...attr.st].some(letter => filter.st.indexOf(letter) >= 0);
  const attackTypeOk = !filter.types.length || attr.types.some(type => filter.types.indexOf(type) >= 0);
  return stateTypeOk && attackTypeOk;
}

/**
 * Parses a hitflag/guardflag string (e.g. "MAF", "HA+") into a flag object.
 * H high, L low, A air, F fall, D down; M (middle) means H and L together; plus/minus are the +/- modifiers.
 * @param {string} raw flag text
 * @returns {{H: boolean, L: boolean, A: boolean, F: boolean, D: boolean, plus: boolean, minus: boolean}}
 */
function parseFlags(raw) {
  const text = (raw || '').toUpperCase(),
    flags = {
      H: false,
      L: false,
      A: false,
      F: false,
      D: false,
      plus: text.indexOf('+') >= 0,
      minus: text.indexOf('-') >= 0
    };
  if (text.indexOf('M') >= 0) {
    flags.H = flags.L = true;
  }
  for (const letter of 'HLAFD') if (text.indexOf(letter) >= 0) flags[letter] = true;
  return flags;
}

/**
 * Evaluates a HitDef or ReversalDef controller into a plain hit-definition object, applying MUGEN defaults.
 * Lengths are scaled by the fighter's k240 (conversion from 240p units to the character's own localcoord).
 * @param {MugenFighter} fighter the attacker whose expressions are evaluated
 * @param {object} controller the HitDef/ReversalDef state controller (with .params)
 * @param {boolean} isReversal true for ReversalDef (reads reversal.attr, keeps revPause)
 * @returns {object} hit definition used by the collision code in world.js
 */
function parseHitDef(fighter, controller, isReversal) {
  // Short evaluators bound to this controller: numeric parameter, presence test, raw string parameter.
  const L = (key, index = 0, fallback = 0) => fighter.n(controller, key, index, fallback),
    has = key => fighter.has(controller, key),
    R = (key, fallback) => fighter.raw(controller, key, fallback),
    k240 = fighter.k240;
  const attrRaw = isReversal ? R('reversal.attr', '') : R('attr', 'S, NA');
  // Core identity first; every other field is filled in below.
  const hitDef = {
    rev: !!isReversal,
    done: false,
    attr: parseAttr(attrRaw),
    id: L('id', 0, 0),
    chainid: L('chainid', 0, -1),
    hitonce: L('hitonce', 0, 1)
  };
  hitDef.hitflag = parseFlags(R('hitflag', 'MAF'));
  hitDef.guardflag = parseFlags(R('guardflag', ''));
  const animTypeName = R('animtype', 'light').toLowerCase();
  hitDef.animtype = MANIM[animTypeName] !== undefined ? MANIM[animTypeName] : 0;
  const airAnimTypeName = R('air.animtype', '');
  hitDef.airAnimtype = airAnimTypeName ? MANIM[airAnimTypeName.toLowerCase()] || 0 : hitDef.animtype;
  const fallAnimTypeName = R('fall.animtype', '');
  hitDef.fallAnimtype = fallAnimTypeName
    ? MANIM[fallAnimTypeName.toLowerCase()] || 0
    : hitDef.airAnimtype >= 4
      ? hitDef.airAnimtype
      : 3;
  const priorityParts = R('priority', '4, Hit') // "level, type"
    .split(',')
    .map(part => part.trim());
  hitDef.prio = parseInt(priorityParts[0], 10);
  if (isNaN(hitDef.prio)) hitDef.prio = 4;
  hitDef.prioType = (priorityParts[1] || 'Hit').toLowerCase();
  hitDef.damage = [L('damage', 0, 0), L('damage', 1, 0)];
  hitDef.pause = [L('pausetime', 0, 0), L('pausetime', 1, 0)];
  hitDef.gpause = has('guard.pausetime')
    ? [L('guard.pausetime', 0, 0), L('guard.pausetime', 1, 0)]
    : hitDef.pause.slice();
  hitDef.spark = R('sparkno', '');
  hitDef.gspark = R('guard.sparkno', '');
  hitDef.sparkxy = [L('sparkxy', 0, 0), L('sparkxy', 1, 0)];
  hitDef.hitsound = R('hitsound', '');
  hitDef.guardsound = R('guardsound', '');
  const groundTypeName = R('ground.type', 'high').toLowerCase();
  hitDef.gtype = MHT[groundTypeName] !== undefined ? MHT[groundTypeName] : 1;
  const airTypeName = R('air.type', '');
  hitDef.atype = airTypeName
    ? MHT[airTypeName.toLowerCase()] !== undefined
      ? MHT[airTypeName.toLowerCase()]
      : hitDef.gtype
    : hitDef.gtype;
  hitDef.gslide = L('ground.slidetime', 0, 0);
  hitDef.ghit = L('ground.hittime', 0, 0);
  hitDef.guardHit = has('guard.hittime') ? L('guard.hittime', 0, 0) : hitDef.ghit;
  hitDef.guardSlide = has('guard.slidetime') ? L('guard.slidetime', 0, 0) : hitDef.guardHit;
  hitDef.guardCtrl = has('guard.ctrltime') ? L('guard.ctrltime', 0, 0) : hitDef.guardSlide;
  hitDef.airGuardCtrl = has('airguard.ctrltime') ? L('airguard.ctrltime', 0, 0) : hitDef.guardCtrl;
  hitDef.airHit = L('air.hittime', 0, 20);
  hitDef.downHit = L('down.hittime', 0, 60);
  hitDef.guardDist = has('guard.dist') ? L('guard.dist', 0, 160 * k240) : fighter.const('size.attack.dist');
  hitDef.yaccel = has('yaccel') ? L('yaccel', 0, 0.35 * k240) : 0.35 * k240;
  hitDef.gvel = [L('ground.velocity', 0, 0), L('ground.velocity', 1, 0)];
  hitDef.avel = [L('air.velocity', 0, 0), L('air.velocity', 1, 0)];
  hitDef.guardVel = [has('guard.velocity') ? L('guard.velocity', 0, 0) : hitDef.gvel[0], 0];
  hitDef.airGuardVel = has('airguard.velocity')
    ? [L('airguard.velocity', 0, 0), L('airguard.velocity', 1, 0)]
    : [hitDef.avel[0] * 1.5, hitDef.avel[1] * 0.5];
  hitDef.downVel = has('down.velocity') ? [L('down.velocity', 0, 0), L('down.velocity', 1, 0)] : hitDef.avel.slice();
  hitDef.fall = L('fall', 0, 0);
  hitDef.airFall = has('air.fall') ? L('air.fall', 0, 0) : hitDef.fall;
  hitDef.fallXvel = has('fall.xvelocity') ? L('fall.xvelocity', 0, 0) : null;
  hitDef.fallYvel = has('fall.yvelocity') ? L('fall.yvelocity', 0, -4.5 * k240) : -4.5 * k240;
  hitDef.fallRecover = L('fall.recover', 0, 1);
  hitDef.fallRecoverTime = L('fall.recovertime', 0, 4);
  hitDef.fallDamage = L('fall.damage', 0, 0);
  hitDef.fallKill = L('fall.kill', 0, 1);
  hitDef.downRecover = L('down.recover', 0, 1);
  hitDef.downRecoverTime = L('down.recovertime', 0, -1);
  hitDef.kill = L('kill', 0, 1);
  hitDef.guardKill = L('guard.kill', 0, 1);
  hitDef.p1stateno = L('p1stateno', 0, -1);
  hitDef.p2stateno = L('p2stateno', 0, -1);
  hitDef.p2getp1state = L('p2getp1state', 0, 1);
  hitDef.p1facing = L('p1facing', 0, 0);
  hitDef.p2facing = L('p2facing', 0, 0);
  hitDef.p1getp2facing = L('p1getp2facing', 0, 0);
  hitDef.forcestand = L('forcestand', 0, 0);
  hitDef.forcecrouch = L('forcecrouch', 0, 0);
  hitDef.getpower = has('getpower')
    ? [
        L('getpower', 0, 0),
        has('getpower') && fighter.L(controller, 'getpower').length > 1 ? L('getpower', 1, 0) : L('getpower', 0, 0) / 2
      ]
    : [hitDef.damage[0] * 0.7, hitDef.damage[0] * 0.35];
  hitDef.givepower = has('givepower')
    ? [
        L('givepower', 0, 0),
        fighter.L(controller, 'givepower').length > 1 ? L('givepower', 1, 0) : L('givepower', 0, 0) / 2
      ]
    : [hitDef.damage[0] * 0.6, hitDef.damage[0] * 0.3];
  hitDef.numhits = L('numhits', 0, 1);
  hitDef.airJuggle = L('air.juggle', 0, 0);
  hitDef.shakeT = L('envshake.time', 0, 0);
  hitDef.shakeA = L('envshake.ampl', 0, -4);
  hitDef.fallShakeT = L('fall.envshake.time', 0, 0);
  hitDef.fallShakeA = L('fall.envshake.ampl', 0, -4);
  hitDef.p1spr = L('p1sprpriority', 0, 1);
  hitDef.p2spr = L('p2sprpriority', 0, 0);
  if (isReversal) {
    hitDef.revPause = hitDef.pause.slice();
    hitDef.p1stateno = L('p1stateno', 0, -1);
    hitDef.p2stateno = L('p2stateno', 0, -1);
  }
  // Does this hit's attribute match a list like ['S', 'NA', 'SA'] (state type first, then attack types)? Used by HitBy/NotHitBy.
  hitDef.attrMatch = function (ids) {
    const stateTypes = ids[0] || '',
      attackTypes = ids.slice(1);
    const stateTypeOk = !stateTypes || [...this.attr.st].some(letter => stateTypes.indexOf(letter) >= 0),
      attackTypeOk = !attackTypes.length || this.attr.types.some(type => attackTypes.indexOf(type) >= 0);
    return stateTypeOk && attackTypeOk;
  };
  return hitDef;
}
