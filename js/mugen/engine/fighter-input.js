/* =====================================================================
   FighterInput: the part of a fighter that turns controller input into
   MUGEN commands.

   Every tick the raw input (up/down/left/right + 6 buttons) is converted to
   a facing-relative direction code (dirHistory: 'N', 'F', 'DB', ...) and a
   button bit mask (buttonHistory). Both histories grow by one entry per tick
   so a command can be matched by looking backwards in time. From the latest
   entry the "hold" flags (B/F/U/D) used by hard-wired actions are derived,
   and every command of the character's .cmd file is tested using MUGEN
   rules: buffer time, time window, ~ (release), / (hold), $ (direction
   sets), > (strict: no other key press in between) and + (simultaneous keys).

   MugenFighter extends this class and provides the fields used here:
   dh (direction history), bh (button history), hold, cmdOn, force, face,
   life, noInput, inputFn, opponent and pkg.commands.
   ===================================================================== */

/** Button bit masks used in the button history. */
const MBIT = { a: 1, b: 2, c: 4, x: 8, y: 16, z: 32, s: 64 };

/** For each direction key, the set of direction codes that satisfy it when written with `$` (e.g. $F accepts F, DF, UF). */
const MDIRSET = {
  F: ['F', 'DF', 'UF'],
  B: ['B', 'DB', 'UB'],
  U: ['U', 'UF', 'UB'],
  D: ['D', 'DF', 'DB'],
  DF: ['DF'],
  DB: ['DB'],
  UF: ['UF'],
  UB: ['UB']
};

/** Base class of MugenFighter: input history and command recognition. */
class FighterInput {
  /**
   * Tells whether a command is currently active (recognised this tick or forced by a controller).
   * @param {string} name command name (case-insensitive)
   * @returns {boolean}
   */
  cmdActive(name) {
    const commandName = (name || '').toLowerCase();
    return !!this.cmdOn[commandName] || this.force[commandName] > 0;
  }

  /** Reads this tick's input, appends it to the histories, updates the hold flags and re-evaluates all commands. */
  readInput() {
    let input = {};
    // Input is only read during the fight, and not while the player is locked, KO'd or scripted.
    const live = G.phase === 'fight' && !G.locked && !this.noInput && this.life > 0;
    if (live && this.inputFn) input = this.inputFn(this, this.opponent) || {};
    // Directions are stored relative to the facing: forward/back instead of right/left.
    const forwardKey = this.face > 0 ? input.right : input.left,
      backKey = this.face > 0 ? input.left : input.right;
    const forward = forwardKey && !backKey,
      back = backKey && !forwardKey,
      up = input.up && !input.down,
      down = input.down && !input.up;
    const direction = (up ? 'U' : down ? 'D' : '') + (back ? 'B' : forward ? 'F' : '') || 'N';
    const buttonBits =
      (input.lk ? 1 : 0) |
      (input.hk ? 2 : 0) |
      (input.c ? 4 : 0) |
      (input.lp ? 8 : 0) |
      (input.hp ? 16 : 0) |
      (input.z ? 32 : 0) |
      (input.bl ? 64 : 0);
    this.dh.push(direction);
    this.bh.push(buttonBits);
    // Keep the histories bounded: drop the oldest 60 ticks once past 240.
    if (this.dh.length > 240) {
      this.dh.splice(0, 60);
      this.bh.splice(0, 60);
    }
    this.hold.B = MDIRSET.B.indexOf(direction) >= 0 ? 1 : 0;
    this.hold.F = MDIRSET.F.indexOf(direction) >= 0 ? 1 : 0;
    this.hold.U = MDIRSET.U.indexOf(direction) >= 0 ? 1 : 0;
    this.hold.D = MDIRSET.D.indexOf(direction) >= 0 ? 1 : 0;
    this.cmdOn = {};
    for (const command of this.pkg.commands) if (this.matchCmd(command)) this.cmdOn[command.name.toLowerCase()] = true;
    // Forced commands (from the AssertCommand-like controllers) count down and expire.
    for (const name in this.force) if (--this.force[name] <= 0) delete this.force[name];
  }

  /**
   * Is the key held at a given history tick?
   * @param {object} keySpec parsed command key: { key, dollar, ... }
   * @param {number} tick index into the histories
   * @returns {boolean}
   */
  keyHeld(keySpec, tick) {
    if (tick < 0) return false;
    const key = keySpec.key;
    if (MDIRSET[key]) {
      const direction = this.dh[tick];
      // `$` accepts any direction of the set; otherwise the direction must match exactly.
      return keySpec.dollar ? MDIRSET[key].indexOf(direction) >= 0 : direction === key;
    }
    const bit = MBIT[key.toLowerCase()];
    return bit !== undefined && (this.bh[tick] & bit) !== 0;
  }

  /**
   * Counts how many consecutive ticks, ending at `tick` and going backwards, the key has been held.
   * @param {object} keySpec parsed command key
   * @param {number} tick history index to start from
   * @returns {number}
   */
  runLen(keySpec, tick) {
    let length = 0;
    while (tick >= 0 && this.keyHeld(keySpec, tick)) {
      length++;
      tick--;
    }
    return length;
  }

  /**
   * Does one step of a command (a group of simultaneous keys) match at the given tick?
   * A step needs at least one key press/release edge unless it consists only of `/` hold keys.
   * @param {object} step parsed command step: { keys: [...] }
   * @param {number} tick history index
   * @returns {boolean}
   */
  stepAt(step, tick) {
    let edge = false,
      allHold = true;
    for (const keySpec of step.keys) {
      const held = this.keyHeld(keySpec, tick),
        heldBefore = this.keyHeld(keySpec, tick - 1);
      if (keySpec.slash) {
        // `/`: the key must simply be held.
        if (!held) return false;
      } else if (keySpec.tilde) {
        // `~`: the key must have just been released (optionally after being charged for `charge` ticks).
        allHold = false;
        if (held || !heldBefore) return false;
        if (keySpec.charge && this.runLen(keySpec, tick - 1) < keySpec.charge) return false;
        edge = true;
      } else {
        // Plain key: must be held, and a fresh press counts as the edge.
        allHold = false;
        if (!held) return false;
        if (!heldBefore) edge = true;
      }
    }
    return allHold || edge;
  }

  /**
   * Is there a new direction or button press at this tick? Used by `>` (strict) commands to reject extra inputs.
   * @param {number} tick history index
   * @returns {boolean}
   */
  pressEdge(tick) {
    if (tick <= 0) return false;
    if (this.dh[tick] !== this.dh[tick - 1] && this.dh[tick] !== 'N') return true;
    return (this.bh[tick] & ~this.bh[tick - 1]) !== 0;
  }

  /**
   * Tests whether a command was entered within its buffer time, by walking its steps backwards in time.
   * @param {object} command parsed command: { name, steps, buf (buffer time), time (time window) }
   * @returns {boolean}
   */
  matchCmd(command) {
    const historyLength = this.dh.length,
      steps = command.steps,
      lastStep = steps.length - 1;
    if (lastStep < 0) return false;
    // The last step must complete within the buffer time (newest tick first).
    for (let endTick = historyLength - 1; endTick >= Math.max(0, historyLength - command.buf); endTick--) {
      if (!this.stepAt(steps[lastStep], endTick)) continue;
      let allFound = true,
        currentTick = endTick;
      // Find each earlier step before the following one, all inside the time window.
      for (let stepIndex = lastStep - 1; stepIndex >= 0; stepIndex--) {
        const strict = steps[stepIndex + 1].greater;
        let foundTick = -1;
        const isRelease = steps[stepIndex].keys.every(keySpec => keySpec.tilde);
        // A release step may happen on the same tick as the following step.
        for (
          let searchTick = isRelease ? currentTick : currentTick - 1;
          searchTick >= 0 && searchTick > endTick - command.time;
          searchTick--
        ) {
          if (this.stepAt(steps[stepIndex], searchTick)) {
            foundTick = searchTick;
            break;
          }
          if (strict && this.pressEdge(searchTick)) break;
        }
        if (foundTick < 0) {
          allFound = false;
          break;
        }
        currentTick = foundTick;
      }
      if (allFound) return true;
    }
    return false;
  }
}
