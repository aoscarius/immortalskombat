/* =====================================================================
   stage-fallback.js - Plain training room. Used only when no MUGEN stage
   is available (and behind the title screen). Drawn with a few fills each
   frame; no bitmaps.
   Implements the same stage interface as a loaded MUGEN stage (ground,
   worldW, camera limits, start positions, drawBack, ...).
   ===================================================================== */
const FALLBACK_STAGE = (() => {
  const WORLD_WIDTH = 1500,
    GROUND_Y = 462;
  return {
    id: 'fallback',
    kind: 'fallback',
    netId: 'fallback',
    name: 'Training Room',
    author: '',
    ground: GROUND_Y,
    worldW: WORLD_WIDTH,
    camMin: 0,
    camMax: WORLD_WIDTH - W,
    p1x: WORLD_WIDTH / 2 - 130,
    p2x: WORLD_WIDTH / 2 + 130,
    leftB: 0,
    rightB: WORLD_WIDTH,
    edgeL: 46,
    edgeR: 46,
    shadow: null,
    music: null,
    /** No per-round state to reset. */
    reset() {},
    /** Static stage: nothing to animate. */
    tick() {},
    /**
     * Draws a dark gradient wall, a darker floor and perspective floor lines.
     * @param {CanvasRenderingContext2D} context Target 2D context.
     * @param {number} camX Camera x offset (scrolls the floor lines).
     */
    drawBack(context, camX) {
      const gradient = context.createLinearGradient(0, 0, 0, GROUND_Y);
      gradient.addColorStop(0, '#15151c');
      gradient.addColorStop(1, '#2a2430');
      context.fillStyle = gradient;
      context.fillRect(0, 0, W, GROUND_Y);
      context.fillStyle = '#0d0c10';
      context.fillRect(0, GROUND_Y, W, H - GROUND_Y);
      context.strokeStyle = '#ffffff14';
      context.lineWidth = 1;
      context.beginPath();
      for (let x = -((camX % 120) + 120) % 120; x < W; x += 120) {
        context.moveTo(x, GROUND_Y);
        context.lineTo(x - (x - W / 2) * 0.6, H);
      }
      context.moveTo(0, GROUND_Y + 0.5);
      context.lineTo(W, GROUND_Y + 0.5);
      context.stroke();
    }
  };
})();
