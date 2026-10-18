/* =====================================================================
   world.js - G: the shared world state around the two fighters.

   G owns everything that is not a fighter's own data: the current stage,
   the camera, screen effects (shake, flash, slow motion), the particle
   list, the round phase and the round timer. It also advances the whole
   simulation by one fixed 60 Hz tick (G.update), which is called by the
   main loop in main.js.

   Round phases (G.phase), driven by match.js:
     'idle' / 'menu'  nothing is running
     'intro'          round banner, fighters are locked
     'fight'          normal play, the timer counts down
     'ko' / 'time'    the round just ended, slow motion or TIME banner
     'over'           winner banner is shown
     'end'            the result screen is up
   ===================================================================== */

/**
 * The shared world state. Particles are plain objects
 * { t: 'spark' | 'dust' | 'ring', x, y, velX, velY, life, max, col, size }
 * where `life` counts down from `max` ticks and `col` is a CSS colour.
 */
const G = {
  fighters: [],
  parts: [],
  /** Screen-shake strength; decays every tick (see update). */
  shake: 0,
  /** White screen-flash opacity, fades out every tick. */
  flash: 0,
  /** Remaining ticks of slow motion (the simulation runs every third tick). */
  slow: 0,
  /** Tick counter since the round/match started. */
  time: 0,
  phase: 'idle',
  paused: false,
  /** True while fighters may not be controlled (intro, KO, ...). */
  locked: false,
  stage: null,
  /** Round timer in seconds (99 at the start of a round). */
  timer: 99,
  /** Ticks elapsed during the 'fight' phase; one timer second per 60. */
  frames: 0,
  mode: 'menu',
  /** Debug: draw hit/hurt boxes (toggled with the B key). */
  showBoxes: false,
  cam: { x: 0 },
  /** Callback invoked when a fighter is KO'd (set by match.js). */
  onKO: null,
  /** Callback invoked once per full simulation tick (set by match.js). */
  onTick: null,

  /**
   * Use a stage: sets the global floor line and world width so fighters and
   * projectiles use the right metrics, and centres the camera on the fighters.
   * @param {object} stage A stage object (loaded MUGEN stage or FALLBACK_STAGE).
   */
  setStage(stage) {
    G.stage = stage;
    GROUND = stage.ground;
    STAGE_W = stage.worldW;
    G.cam.x = clamp((stage.p1x + stage.p2x) / 2 - W / 2, stage.camMin, stage.camMax);
    if (stage.reset) stage.reset();
  },

  /**
   * Spawns a burst of spark particles flying in random directions.
   * @param {number} x World x.
   * @param {number} y World y.
   * @param {string} color CSS colour.
   * @param {number} count Number of sparks.
   * @param {number} maxSpeed Fastest spark speed; the slowest is 30% of it.
   */
  burst(x, y, color, count, maxSpeed) {
    for (let i = 0; i < count; i++) {
      const angle = rnd(0, 6.28),
        speed = rnd(maxSpeed * 0.3, maxSpeed);
      G.parts.push({
        t: 'spark',
        x,
        y,
        velX: Math.cos(angle) * speed,
        velY: Math.sin(angle) * speed,
        life: rint(10, 22),
        max: 22,
        col: color,
        size: rnd(1.5, 3.5)
      });
    }
  },

  /**
   * Spawns one expanding shock ring.
   * @param {number} x World x.
   * @param {number} y World y.
   * @param {string} color CSS colour.
   * @param {number} radius Stored in `size`; scales how far the ring grows.
   */
  ring(x, y, color, radius) {
    G.parts.push({ t: 'ring', x, y, velX: 0, velY: 0, life: 14, max: 14, col: color, size: radius });
  },

  /**
   * Spawns dust puffs on the floor around an x position.
   * @param {number} x World x of the centre.
   * @param {number} count Number of puffs.
   */
  dust(x, count) {
    for (let i = 0; i < count; i++)
      G.parts.push({
        t: 'dust',
        x: x + rnd(-14, 14),
        y: GROUND - 4,
        velX: rnd(-2.5, 2.5),
        velY: rnd(-1.6, -0.2),
        life: rint(14, 28),
        max: 28,
        col: '#d8c0a0',
        size: rnd(4, 9)
      });
  },

  /** Moves and ages all particles, removes dead ones and caps the list at 300. */
  updateParts() {
    const particles = G.parts;
    for (let i = particles.length - 1; i >= 0; i--) {
      const particle = particles[i];
      particle.x += particle.velX;
      particle.y += particle.velY;
      if (particle.t === 'spark') {
        particle.velY += 0.25; // gravity
        particle.velX *= 0.96; // air drag
      } else if (particle.t === 'dust') {
        particle.velX *= 0.92;
        particle.size += 0.25; // puffs grow as they fade
      }
      if (--particle.life <= 0) particles.splice(i, 1);
    }
    if (particles.length > 300) particles.splice(0, particles.length - 300);
  },

  /**
   * One simulation tick; everything in here must depend only on the inputs
   * and the seeded RNG, so both peers stay in lockstep online.
   */
  update() {
    if (G.paused) return;
    G.time++;
    if (G.shake > 0) G.shake *= 0.86;
    if (G.shake < 0.3) G.shake = 0;
    if (G.flash > 0) G.flash = Math.max(0, G.flash - 0.035);
    if (G.stage && G.stage.tick) G.stage.tick();
    if (G.slow > 0) {
      G.slow--;
      // slow motion: only every third tick advances the fighters
      if (G.time % 3) {
        G.updateParts();
        return;
      }
    }
    G.updateParts();
    const [fighter1, fighter2] = G.fighters;
    if (!fighter1 || !fighter2) return;
    Mugen.tick(fighter1, fighter2);
    if (G.onTick) G.onTick();
  },

  /**
   * Compact FNV-1a style checksum of the simulation state, used to detect
   * desyncs between online peers.
   * @returns {number} Unsigned 32-bit hash.
   */
  stateHash() {
    let hash = 2166136261 >>> 0;
    /** Folds one number into the running FNV-1a style hash. */
    const mix = value => {
      hash ^= (Math.round(value * 16) | 0) & 0xffffffff; // 1/16 precision hides float noise
      hash = Math.imul(hash, 16777619) >>> 0;
    };
    mix(G.time);
    mix(G.timer);
    for (const fighter of G.fighters) {
      mix(fighter.posX);
      mix(fighter.posY);
      mix(fighter.life);
      mix(fighter.stateno);
      mix(fighter.time);
      mix(fighter.power);
      mix(fighter.velX);
      mix(fighter.velY);
      mix(fighter.helpers.length);
      for (const helper of fighter.helpers) {
        mix(helper.posX);
        mix(helper.posY);
        mix(helper.stateno);
      }
    }
    return hash >>> 0;
  }
};
