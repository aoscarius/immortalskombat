/* =====================================================================
   MUGEN drawing: sprites and animations, fighters, projectiles/explods,
   collision-box debug view and character portraits. This file and
   game/render.js are the only places that touch the canvas for gameplay.

   Key concepts:
   - Sprite: a bitmap from the character's SFF file, addressed by "group,index".
   - Animation frame: references a sprite plus offset, flips, scale and a
     transparency mode (trans: "A" additive, "AS<n>" alpha, "S" subtractive).
   - Palette slot: which colour palette (1-12) the sprite is rendered with.
   - Explod: a cosmetic animation spawned by a controller; projectiles are
     flying attacks. Both are drawn here, in front of or behind the fighters.
   - Coordinates: screen X is world X minus the camera; Y is GROUND plus
     the (negative-up) height in pixels.
   ===================================================================== */

/**
 * Draw the current frame of an animation at a screen position.
 * @param {CanvasRenderingContext2D} ctx Target canvas context.
 * @param {object} pkg Character package (SFF sprites, constants).
 * @param {object} animation MAnim instance whose current frame is drawn.
 * @param {number} palSlot Palette slot used to colour the sprite.
 * @param {number} screenX Screen X of the animation origin.
 * @param {number} screenY Screen Y of the animation origin.
 * @param {number} face Facing: 1 = right, -1 = left (mirrors the sprite).
 * @param {number} scale Character scale (stage scale factor).
 * @param {object} [options] Extra: `scale` [x, y] multiplier, `trans` transparency string, `alpha` 0..1.
 */
Mugen.drawAnim = function (ctx, pkg, animation, palSlot, screenX, screenY, face, scale, options) {
  options = options || {};
  const frame = animation.frame();
  if (!frame) return;
  const sprite = pkg.sff.sprites.get(frame.g + ',' + frame.i);
  if (!sprite) return;
  const spriteCanvas = MG.spriteCanvas(pkg, sprite, palSlot);
  if (!spriteCanvas) return;
  // total scale = character constant * frame scale * caller scale
  const scaleX =
      (pkg.consts['size.xscale'] ? pkg.consts['size.xscale'][0] : 1) *
      (frame.xs || 1) *
      ((options.scale && options.scale[0]) || 1),
    scaleY =
      (pkg.consts['size.yscale'] ? pkg.consts['size.yscale'][0] : 1) *
      (frame.ys || 1) *
      ((options.scale && options.scale[1]) || 1);
  const flipX = (face < 0 ? -1 : 1) * (frame.fh ? -1 : 1),
    flipY = frame.fv ? -1 : 1;
  ctx.save();
  ctx.translate(screenX + face * frame.x * scaleX * scale, screenY + frame.y * scaleY * scale);
  ctx.scale(flipX * scaleX * scale, flipY * scaleY * scale);
  const trans = (frame.trans || options.trans || '').toUpperCase();
  if (trans[0] === 'A') {
    // additive blending; "AS<n>" gives the source alpha out of 256
    ctx.globalCompositeOperation = 'lighter';
    const alphaMatch = trans.match(/^AS(\d+)/);
    ctx.globalAlpha = alphaMatch ? +alphaMatch[1] / 256 : trans === 'A1' ? 0.5 : 1;
  } else if (trans[0] === 'S') {
    ctx.globalCompositeOperation = 'difference';
  }
  if (options.alpha !== undefined) ctx.globalAlpha *= options.alpha;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(spriteCanvas, -sprite.ax, -sprite.ay);
  ctx.restore();
};

/**
 * Does the character provide a palette for the given slot?
 * @param {object} pkg Character package.
 * @param {number} slot Palette slot number.
 * @returns {boolean} True when the slot exists (slots 0 and 1 always do).
 */
Mugen.hasPal = function (pkg, slot) {
  return slot <= 1 || (pkg.sff.ver === 2 ? pkg.sff.palByKey['1,' + slot] !== undefined : !!pkg.acts[slot]);
};

/**
 * Draw a fighter or helper with its ground shadow and optional glow.
 * @param {CanvasRenderingContext2D} ctx Target canvas context.
 * @param {object} fighter The fighter or helper to draw.
 * @param {number} cameraX Camera left edge in world pixels.
 */
Mugen.drawFighter = function (ctx, fighter, cameraX) {
  if (fighter.asf.has('invisible')) return;
  const screenX = fighter.x - cameraX,
    groundY = GROUND + fighter.posY * fighter.s,
    // the shadow shrinks and fades as the fighter rises above the ground
    shadowShrink = clamp(1 + (fighter.posY * fighter.s) / 260, 0.25, 1);
  const stageShadow = G.stage && G.stage.shadow,
    shadowColor = stageShadow ? stageShadow.rgb : [0, 0, 0],
    shadowAlpha = fighter.isHelper ? 0 : stageShadow ? stageShadow.intensity : 0.4,
    shadowYScale = stageShadow ? stageShadow.yscale : 0.4;
  ctx.fillStyle =
    'rgba(' + shadowColor[0] + ',' + shadowColor[1] + ',' + shadowColor[2] + ',' + shadowAlpha * shadowShrink + ')';
  ctx.beginPath();
  ctx.ellipse(
    screenX,
    GROUND + 3,
    (fighter.type === 'L' ? 80 : ((44 * fighter.s) / 2.25) * 1.1) * shadowShrink,
    Math.max(3, 22 * shadowYScale) * shadowShrink,
    0,
    0,
    7
  );
  ctx.fill();
  if (fighter.glow > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gradient = ctx.createRadialGradient(screenX, groundY - 90, 10, screenX, groundY - 90, 120);
    gradient.addColorStop(0, '#ffd36aaa');
    gradient.addColorStop(1, '#ffd36a00');
    ctx.fillStyle = gradient;
    ctx.fillRect(screenX - 130, groundY - 220, 260, 260);
    ctx.restore();
  }
  ctx.save();
  // missing palette: fake an alternate colour scheme with a hue rotation
  if (fighter.palSlot > 1 && !Mugen.hasPal(fighter.pkg, fighter.palSlot))
    ctx.filter = 'hue-rotate(150deg) saturate(1.15)';
  Mugen.drawAnim(
    ctx,
    fighter.animation.pkg,
    fighter.animation,
    fighter.palSlot,
    screenX + fighter.shakeX * 3 * fighter.face * -1,
    groundY,
    fighter.face,
    fighter.s,
    { trans: fighter.trans }
  );
  ctx.restore();
};

/**
 * Draw all explods and (when drawing the front layer) projectiles of every fighter and helper.
 * @param {CanvasRenderingContext2D} ctx Target canvas context.
 * @param {number} cameraX Camera left edge in world pixels.
 * @param {boolean} front True for the layer in front of the fighters (ontop explods + projectiles), false for behind.
 */
Mugen.drawWorld = function (ctx, cameraX, front) {
  for (const fighter of G.fighters.flatMap(root => [root, ...root.helpers])) {
    for (const explod of fighter.explods) {
      if (!!explod.ontop !== front) continue;
      const screenX = explod.posX * explod.s + STAGE_W / 2 - cameraX;
      Mugen.drawAnim(
        ctx,
        explod.pkg,
        explod.animation,
        fighter.palSlot,
        screenX,
        GROUND + explod.posY * explod.s,
        explod.face,
        explod.s,
        { scale: explod.scale, trans: explod.trans }
      );
    }
    if (front)
      for (const projectile of fighter.projs)
        Mugen.drawAnim(
          ctx,
          fighter.pkg,
          projectile.animation,
          fighter.palSlot,
          projectile.wx - cameraX,
          GROUND + projectile.posY * projectile.s,
          projectile.face,
          projectile.s,
          { scale: projectile.scale }
        );
  }
};

/**
 * Debug view: outline hurt boxes (green), attack boxes (red), projectile boxes and each fighter's origin cross.
 * @param {CanvasRenderingContext2D} ctx Target canvas context.
 * @param {number} cameraX Camera left edge in world pixels.
 */
Mugen.drawBoxes = function (ctx, cameraX) {
  ctx.save();
  ctx.lineWidth = 1.5;
  for (const fighter of G.fighters.flatMap(root => [root, ...root.helpers])) {
    // box kind 2 = hurt boxes (Clsn2), kind 1 = attack boxes (Clsn1)
    for (const [kind, color] of [
      [2, '#3bf06a'],
      [1, '#ff4a3a']
    ])
      for (const box of Mugen.boxes(fighter, kind)) {
        ctx.strokeStyle = color;
        ctx.strokeRect(box.l - cameraX, GROUND + box.t, box.r - box.l, box.b - box.t);
      }
    for (const projectile of fighter.projs)
      for (const box of Mugen.projBoxes(projectile)) {
        ctx.strokeStyle = '#ff4a3a';
        ctx.strokeRect(box.l - cameraX, GROUND + box.t, box.r - box.l, box.b - box.t);
      }
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(fighter.x - cameraX - 6, GROUND + fighter.posY * fighter.s);
    ctx.lineTo(fighter.x - cameraX + 6, GROUND + fighter.posY * fighter.s);
    ctx.moveTo(fighter.x - cameraX, GROUND + fighter.posY * fighter.s - 6);
    ctx.lineTo(fighter.x - cameraX, GROUND + fighter.posY * fighter.s + 6);
    ctx.stroke();
  }
  ctx.restore();
};

/**
 * Paint a character portrait (select-screen style) onto a canvas.
 * Uses the character's portrait sprite (group 9000) and falls back to animation 0 frame 0, then to an initial letter.
 * @param {HTMLCanvasElement} canvas Destination canvas.
 * @param {object} character Roster entry (`mugen` package, `bg` gradient colours, `palSlot`, `name`, `c.accent`).
 * @param {boolean} crop True to prefer the small portrait (9000,0) and fill-crop the canvas.
 */
Mugen.portrait = function (canvas, character, crop) {
  const ctx = canvas.getContext('2d'),
    width = canvas.width,
    height = canvas.height,
    pkg = character.mugen;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, character.bg[0]);
  gradient.addColorStop(1, character.bg[1]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  const keys = crop ? ['9000,0', '9000,1'] : ['9000,1', '9000,0'];
  let sprite = null;
  for (const key of keys) {
    sprite = pkg.sff.sprites.get(key);
    if (sprite && sprite.w > 4) break;
    sprite = null;
  }
  let spriteCanvas = null,
    cropMode = !!sprite;
  if (sprite) spriteCanvas = MG.spriteCanvas(pkg, sprite, character.palSlot || 1);
  else {
    // no portrait sprite: use the first frame of animation 0
    const idleAnim = pkg.air.get(0),
      frame = idleAnim && idleAnim.frames[0];
    const frameSprite = frame && pkg.sff.sprites.get(frame.g + ',' + frame.i);
    if (frameSprite) {
      sprite = frameSprite;
      spriteCanvas = MG.spriteCanvas(pkg, frameSprite, character.palSlot || 1);
    }
  }
  if (!spriteCanvas) {
    // last resort: the first letter of the character name
    ctx.fillStyle = character.c.accent;
    ctx.font = '700 ' + height * 0.3 + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(character.name[0] || '?', width / 2, height * 0.62);
    return;
  }
  ctx.imageSmoothingEnabled = false;
  const fit = cropMode
    ? Math.max(width / spriteCanvas.width, height / spriteCanvas.height)
    : Math.min((width * 0.9) / spriteCanvas.width, (height * 0.92) / spriteCanvas.height);
  const drawW = spriteCanvas.width * fit,
    drawH = spriteCanvas.height * fit;
  ctx.drawImage(spriteCanvas, (width - drawW) / 2, cropMode ? (height - drawH) / 2 : height - drawH - 4, drawW, drawH);
};
