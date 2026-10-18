/* =====================================================================
   MUGEN animation player (MAnim).
   Plays one AIR action: tracks the current element, the time inside it and
   the time inside the whole action, and answers the AnimTime / AnimElem*
   triggers. `time` counts ticks since the action started and wraps at the
   loop point, exactly as the MUGEN triggers expect.
   An "action" is one numbered animation of the .air file; an "element" is
   one frame (sprite + duration) of that action.
   ===================================================================== */

/** Plays one AIR action and exposes the animation-related trigger values. */
class MAnim {
  /** @param {object} pkg character package whose .air file provides the actions */
  constructor(pkg) {
    this.pkg = pkg;
    this.no = -1; // current action number (-1 = none)
    this.act = null; // parsed action: { frames, start, total, inf, loopStart, loopTick }
    this.elem = 0; // index of the current element
    this.etime = 0; // ticks spent in the current element
    this.time = 0; // ticks since the action started (wraps at the loop point)
    this.loops = 0; // how many times the action has looped
  }

  /**
   * Starts an action. Returns false (and keeps the old one) if it does not exist.
   * @param {number} animNumber action number in the .air file
   * @param {number} [elementIndex] element to start at (0-based)
   * @param {object} [pkg] package to take the action from (defaults to the current one)
   */
  set(animNumber, elementIndex = 0, pkg) {
    if (pkg) this.pkg = pkg;
    const action = this.pkg.air.get(animNumber);
    if (!action || !action.frames.length) {
      MG.warn('Missing animation ' + animNumber + ' in ' + this.pkg.name);
      return false;
    }
    this.no = animNumber;
    this.act = action;
    this.elem = 0;
    this.etime = 0;
    this.time = 0;
    this.loops = 0;
    if (elementIndex > 0) {
      elementIndex = Math.min(elementIndex, action.frames.length - 1);
      this.elem = elementIndex;
      this.time = action.start[elementIndex] !== undefined ? action.start[elementIndex] : 0;
    }
    return true;
  }

  /** Total duration of the action in ticks, or -1 if it ends in an infinite (-1 time) element. */
  get total() {
    return this.act ? (this.act.inf ? -1 : this.act.total) : 0;
  }

  /** The current element (frame) of the action, or null when no action is loaded. */
  frame() {
    const action = this.act;
    return action ? action.frames[Math.min(this.elem, action.frames.length - 1)] : null;
  }

  /** AnimTime trigger: ticks until the action ends (0 at the last tick, negative before). */
  animTime() {
    return this.act ? this.time - this.total : 0;
  }

  /**
   * AnimElemTime trigger: ticks since the given element (1-based) started; negative before it starts.
   * @param {number} elementNumber 1-based element number
   */
  elemTime(elementNumber) {
    const action = this.act;
    if (!action) return 0;
    if (elementNumber > action.frames.length) {
      const remaining = this.animTime();
      return remaining > 0 ? 0 : remaining;
    }
    let ticks = this.time;
    const elementsBefore = Math.max(0, elementNumber) - 1;
    for (let i = 0; i < elementsBefore; i++) ticks -= Math.max(0, action.frames[i].time);
    return ticks;
  }

  /** AnimElemNo trigger: current element number, 1-based (the `rel` argument has no effect). */
  elemNo(rel) {
    const action = this.act;
    if (!action) return 0;
    return Math.min(action.frames.length, Math.max(1, this.elem + 1 + (rel > 0 ? 0 : 0)));
  }

  /** Advances the animation by one tick: moves to the next element when the current one has run its duration. */
  tick() {
    const action = this.act;
    if (!action || !action.frames.length) return;
    const frames = action.frames,
      totalTicks = this.total,
      currentFrame = () => frames[Math.min(this.elem, frames.length - 1)];
    // Moves to the next element with a positive duration (the last one is kept when the action is infinite).
    const advanceElement = () => {
      if (totalTicks !== -1 || this.elem < frames.length - 1) {
        this.etime = 0;
        for (;;) {
          this.elem++;
          if (
            (totalTicks === -1 && this.elem === frames.length - 1) ||
            this.elem >= frames.length ||
            frames[this.elem].time > 0
          )
            break;
        }
      }
    };
    // A zero-length element is skipped immediately.
    if (this.elem < frames.length && currentFrame().time <= 0) advanceElement();
    if (this.elem < frames.length) {
      this.etime++;
      if (this.etime >= currentFrame().time) {
        advanceElement();
        if (this.elem >= frames.length) this.elem = action.loopStart;
      }
    } else this.elem = action.loopStart;
    // Wrap the action time at the loop point.
    if (totalTicks !== -1 && this.time >= totalTicks) {
      this.time = totalTicks - (action.total - action.loopTick);
      this.loops++;
    }
    this.time++;
  }
}
