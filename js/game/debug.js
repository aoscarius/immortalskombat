/* =====================================================================
   Debug overlay and bug report.
     SPACE  cheat: full life and power for the human players
     F2     cheat: the CPU opponent drops to 1 life (arcade / practice only)
     F4  toggle the overlay: per fighter state, animation, position,
         velocity, active commands, plus the character health check and the
         latest engine warnings.
     F3  copy a report (character info, health check, warnings and the last
         120 ticks of both fighters) to the clipboard. Attach it to a bug.
   The overlay costs nothing while hidden; the tick trace is recorded only
   while it is visible.
   ===================================================================== */
/** Debug overlay, cheats and bug-report builder. */
const Debug = {
  on: false, // overlay visible
  ring: [[], []], // per fighter: last RING tick samples
  RING: 120,
  last: 0, // timestamp of the last overlay repaint

  /**
   * Whether cheats may run. They change the simulation, so they are off online
   * (both sides must stay in lockstep).
   * @returns {boolean} true while a local, unpaused fight is running
   */
  cheatOk() {
    return G.phase === 'fight' && !Net.active && !G.paused;
  },

  /** Cheat: refills life and power of the human players (both fighters in versus). */
  cheatFill() {
    if (!this.cheatOk()) return;
    G.fighters.forEach((fighter, index) => {
      if (index === 0 || Match.mode === 'versus') {
        fighter.life = fighter.maxHp;
        fighter.power = fighter.powerMax;
      }
    });
    Snd.ui();
  },

  /** Cheat: drops the CPU opponent to 1 life (not available in versus). */
  cheatEnemy() {
    if (!this.cheatOk() || Match.mode === 'versus') return;
    const enemy = G.fighters[1];
    if (enemy && enemy.life > 1) {
      enemy.life = 1;
      Snd.ui();
    }
  },

  /** Shows or hides the overlay; the tick trace is recorded only while it is visible. */
  toggle() {
    this.on = !this.on;
    const panel = $('#dbg');
    panel.hidden = !this.on;
    MG.trace = this.on ? fighter => this.sample(fighter) : null;
    if (this.on) this.ring = [[], []];
    if (this.on) this.paint();
  },

  /**
   * Records one tick of a fighter in its ring buffer (oldest samples are dropped).
   * @param {object} fighter fighter that just ticked
   */
  sample(fighter) {
    const samples = this.ring[fighter.idx];
    samples.push([
      fighter.tickN,
      fighter.stateno,
      fighter.animation.no,
      fighter.animation.elem,
      +fighter.posX.toFixed(1),
      +fighter.posY.toFixed(1),
      +fighter.velX.toFixed(2),
      +fighter.velY.toFixed(2),
      fighter.ctrl ? 1 : 0,
      fighter.hitPause,
      fighter.movetype + fighter.type + fighter.physics
    ]);
    if (samples.length > this.RING) samples.shift();
  },

  /**
   * Formats the multi-line overlay text for one fighter.
   * @param {object} fighter fighter to describe
   * @returns {string} state, animation, position, velocity and active commands
   */
  describe(fighter) {
    const anim = fighter.animation,
      commands = Object.keys(fighter.cmdOn).join(' ') || '-',
      elementCount = anim.act ? anim.act.frames.length : 0;
    return (
      (fighter.idx ? 'P2 ' : 'P1 ') +
      fighter.name +
      '\n  state ' +
      fighter.stateno +
      ' t=' +
      fighter.time +
      '  type ' +
      fighter.type +
      ' move ' +
      fighter.movetype +
      ' phys ' +
      fighter.physics +
      '  ctrl ' +
      (fighter.ctrl ? 1 : 0) +
      '  hitpause ' +
      fighter.hitPause +
      '\n  anim ' +
      anim.no +
      ' elem ' +
      (anim.elem + 1) +
      '/' +
      elementCount +
      ' etime ' +
      anim.etime +
      ' time ' +
      anim.time +
      '\n  pos ' +
      fighter.posX.toFixed(1) +
      ',' +
      fighter.posY.toFixed(1) +
      ' vel ' +
      fighter.velX.toFixed(2) +
      ',' +
      fighter.velY.toFixed(2) +
      ' face ' +
      fighter.face +
      ' life ' +
      fighter.life +
      ' power ' +
      fighter.power +
      '\n  commands: ' +
      commands
    );
  },

  /**
   * One-line character health check (counts, SFF version, missing animations, unsupported controllers).
   * @param {object} fighter fighter whose package is checked
   * @returns {string} summary line, or '' when the package has no health data
   */
  health(fighter) {
    const health = fighter.pkg.health;
    return health
      ? '  ' +
          fighter.name +
          ': ' +
          health.actions +
          ' anims, ' +
          health.states +
          ' states, SFF v' +
          health.sffVersion +
          (health.missingAnims.length ? ', missing anims ' + health.missingAnims.join(',') : '') +
          (health.unsupportedControllers.length ? ', unsupported ' + health.unsupportedControllers.join(',') : '')
      : '';
  },

  /** Redraws the overlay text (does nothing while it is hidden). */
  paint() {
    const panel = $('#dbg');
    if (!panel || panel.hidden) return;
    const fighters = G.fighters;
    let text = 'DEBUG  F4 hide  F3 copy report\n';
    text +=
      fighters.map(fighter => this.describe(fighter)).join('\n') +
      '\nHealth\n' +
      fighters.map(fighter => this.health(fighter)).join('\n');
    const recentWarnings = MG.log.slice(-4);
    if (recentWarnings.length) text += '\nWarnings\n  ' + recentWarnings.join('\n  ');
    panel.textContent = text;
  },

  /**
   * Per-frame hook: repaints the overlay at most every 100 ms.
   * @param {number} now frame timestamp in milliseconds
   */
  update(now) {
    if (this.on && now - this.last > 100) {
      this.last = now;
      this.paint();
    }
  },

  /**
   * Builds the bug report: environment, character info, health checks, warnings and the tick trace.
   * @returns {string} JSON text
   */
  report() {
    return JSON.stringify({
      game: 'Immortals Kombat',
      when: new Date().toISOString(),
      ua: navigator.userAgent,
      base: Content.base,
      mode: Match.mode,
      stage: G.stage && G.stage.name,
      fighters: G.fighters.map(fighter => ({
        name: fighter.name,
        health: fighter.pkg.health,
        localcoord: fighter.pkg.local,
        state: fighter.stateno,
        anim: fighter.animation.no
      })),
      warnings: MG.log.slice(-40),
      trace: {
        columns: 'tick,state,anim,elem,posX,posY,velX,velY,ctrl,hitpause,move+type+physics',
        p1: this.ring[0],
        p2: this.ring[1]
      }
    });
  },

  /** Copies the report to the clipboard, or leaves it in window.IK_REPORT when the clipboard is unavailable. */
  async copy() {
    const text = this.report();
    try {
      await navigator.clipboard.writeText(text);
      alert_('Report copied (' + Math.round(text.length / 1024) + ' KB). Paste it where you report the problem.');
    } catch (error) {
      window.IK_REPORT = text;
      alert_('Could not use the clipboard. The report is in window.IK_REPORT (browser console).');
    }
  }
};
