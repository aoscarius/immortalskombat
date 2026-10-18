/* =====================================================================
   render.js - Renderer: stage back layers, fighters, projectiles and
   explods, stage front layers, effects. The whole scene is drawn to one
   960x540 canvas (#cv).
   All sprite drawing goes through Mugen.drawAnim, so this file and
   mugen/world.js are the only places that would change for another backend.
   ===================================================================== */
const cv = $('#cv'),
  ctx = cv.getContext('2d', { alpha: false });

/**
 * Draws the effect particles (sparks, dust, rings) of G.parts.
 * @param {CanvasRenderingContext2D} context Target 2D context.
 * @param {number} camX Camera x offset subtracted from world x.
 */
function drawParts(context, camX) {
  for (const particle of G.parts) {
    const alpha = particle.life / particle.max,
      x = particle.x - camX;
    if (particle.t === 'spark') {
      context.globalAlpha = alpha;
      context.strokeStyle = particle.col;
      context.lineWidth = particle.size;
      context.lineCap = 'round';
      context.beginPath();
      context.moveTo(x, particle.y);
      context.lineTo(x - particle.velX * 1.6, particle.y - particle.velY * 1.6); // streak opposite to motion
      context.stroke();
    } else if (particle.t === 'dust') {
      context.globalAlpha = alpha * 0.35;
      context.fillStyle = particle.col;
      context.beginPath();
      context.arc(x, particle.y, particle.size, 0, 7);
      context.fill();
    } else if (particle.t === 'ring') {
      context.globalAlpha = alpha;
      context.strokeStyle = particle.col;
      context.lineWidth = 4 * alpha + 1;
      context.beginPath();
      context.arc(x, particle.y, particle.size * (1 - alpha) + 6, 0, 7);
      context.stroke();
    }
  }
  context.globalAlpha = 1;
}

/**
 * Draws one complete frame: stage, world layers, sorted fighters and helpers,
 * optional debug boxes, super-pause darkening, particles and the white flash.
 * Called once per animation frame by the main loop.
 */
function render() {
  const context = ctx,
    stage = G.stage,
    camX = G.cam.x;
  MG.cache.frame++;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, W, H);
  if (!stage) {
    context.fillStyle = '#000';
    context.fillRect(0, 0, W, H);
    return;
  }
  context.save();
  if (G.shake > 0) context.translate((Math.random() - 0.5) * G.shake * 1.6, (Math.random() - 0.5) * G.shake * 1.6);
  stage.drawBack(context, camX);
  Mugen.drawWorld(context, camX, false);
  // players and their helpers, drawn in sprite-priority order
  const drawList = G.fighters
    .flatMap(fighter => [fighter, ...fighter.helpers])
    .sort((a, b) => a.sprPri - b.sprPri || b.idx - a.idx || a.uid - b.uid);
  for (const fighter of drawList) Mugen.drawFighter(context, fighter, camX);
  Mugen.drawWorld(context, camX, true);
  if (stage.drawFront) stage.drawFront(context, camX);
  if (G.showBoxes) Mugen.drawBoxes(context, camX);
  if (Mugen.pause && Mugen.pause.dark) {
    context.fillStyle = 'rgba(0,0,0,.35)';
    context.fillRect(0, 0, W, H);
  }
  drawParts(context, camX);
  context.restore();
  if (G.flash > 0) {
    context.globalAlpha = Math.min(1, G.flash);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, W, H);
    context.globalAlpha = 1;
  }
}
