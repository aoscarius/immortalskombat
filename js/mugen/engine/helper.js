/* =====================================================================
   Helpers: extra entities spawned by the Helper controller. A helper is a
   full state machine of its own (own variables, states, animation, hitdefs,
   explods and projectiles) that belongs to a player, so it extends
   MugenFighter and only differs where a player would behave differently:
     - no input and no commands (its triggers can still read the root's),
     - no hard-wired walking/jumping/landing, no get-hit handling,
     - never a target of attacks, never screen-bound,
     - removed by DestroySelf, or when the round restarts.
   Spawning, binding and per-tick updates live in Mugen (world.js).
   Terms: "root" is the real player at the top of the helper chain;
   "parent" is the entity that spawned this helper (root or another helper).
   ===================================================================== */

/** Counter that hands out unique ids to helpers (starts above the player uids). */
let HELPER_UID = 1000;

/** An entity spawned by a Helper controller; a MugenFighter without input or hard-wired behaviour. */
class MugenHelper extends MugenFighter {
  /**
   * @param {MugenFighter} parent entity that spawns this helper (player or another helper)
   * @param {object} options evaluated Helper controller parameters: id, name, pausemovetime, supermovetime
   */
  constructor(parent, options) {
    super({ mugen: parent.pkg }, parent.idx, null, parent.palSlot);
    this.isHelper = true;
    this.parent = parent;
    this.root = parent.root || parent;
    this.hid = options.id | 0; // helper id, matched by the Helper(id) redirection
    this.name = options.name || 'helper';
    this.uid = ++HELPER_UID;
    this.pmt = options.pausemovetime | 0; // how long the helper keeps moving during a hit pause
    this.smt = options.supermovetime | 0; // how long the helper keeps moving during a super pause
    this.hBind = null; // active bind to another entity (set by the Bind* controllers)
    this.dead = false;
    this.life = this.maxHp = 1000;
    this.power = 0;
  }

  /** Helpers never read a controller: all held directions and active commands are cleared every tick. */
  readInput() {
    this.hold.B = this.hold.F = this.hold.U = this.hold.D = 0;
    this.cmdOn = {};
  }
}
