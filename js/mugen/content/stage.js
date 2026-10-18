/* =====================================================================
   MUGEN stages (backgrounds): stage .def parsing, background layers
   (normal, anim, parallax), BGCtrl subset, camera limits, shadow, music.
   A loaded stage exposes the same interface as the built-in stages:
     name, ground, worldW, camMin, camMax, p1x, p2x, leftB, rightB,
     tick(), drawBack(ctx, cam), drawFront(ctx, cam), reset()

   Units: stage files use their own "localcoord" units; `screenScale`
   (stored as st.ss) converts them to screen pixels. The stage origin
   (stage x = 0) sits at the middle of the world, worldW / 2.
   ===================================================================== */

/** Matches a [BG name] section title; group 1 is the part after "BG ". */
const SECT_BG = /^bg\s+(.*)$/;

/**
 * Parses a comma separated number list and pads/truncates it to a fixed length.
 * @param {string} text Raw list such as "1, 2" (may be undefined).
 * @param {number} count Wanted number of values.
 * @param {number[]} defaults Values used for missing entries.
 * @returns {number[]} Exactly `count` numbers.
 */
const bgNums = (text, count, defaults) => {
  const parsed = parseNumberList(text);
  const values = [];
  for (let index = 0; index < count; index++)
    values.push(parsed[index] !== undefined ? parsed[index] : defaults[index]);
  return values;
};

/**
 * Loads a MUGEN stage: parses its .def, loads the sprites and music, and builds the runtime object.
 * @param {object} found "found" record from the loader scan ({ vfs, f, def?, text? }).
 * @param {function(string): void} [onProgress] Receives human-readable progress messages.
 * @returns {Promise<object>} The stage object (see file header for its interface).
 */
MG.loadStage = async function (found, onProgress) {
  const { vfs, f: defFile } = found;
  let { def, text } = found;
  if (!text) text = MG.decodeText(await defFile.read());
  if (!def) def = MG.parseDef(text);
  const sections = def.sections,
    dir = defFile.path.split('/').slice(0, -1).join('/').toLowerCase();
  const reportProgress = message => onProgress && onProgress(def.name + ': ' + message);
  const usedFiles = [defFile];
  // Reads a file referenced by the .def and remembers it for export to a peer.
  const readFile = async name => {
    const file = resolveIn(vfs, dir, unquote(name));
    if (file) usedFiles.push(file);
    return file ? file.read() : null;
  };
  // Key/value map of a section ({} when the section is absent).
  const sectionMap = sectionName => (sections[sectionName] ? sections[sectionName].map : {});
  const info = sectionMap('info'),
    cameraInfo = sectionMap('camera'),
    playerInfo = sectionMap('playerinfo'),
    boundInfo = sectionMap('bound'),
    stageInfo = sectionMap('stageinfo'),
    shadowInfo = sectionMap('shadow'),
    musicInfo = sectionMap('music'),
    bgdef = sectionMap('bgdef');
  const localCoordList = parseNumberList(stageInfo['localcoord']);
  const local = localCoordList.length >= 2 ? localCoordList : [320, 240];
  const stage = {
    id: 'st:' + defFile.path.toLowerCase(),
    kind: 'mugen',
    name: unquote(info['displayname'] || info['name'] || def.name || 'Stage'),
    author: unquote(info['author'] || ''),
    local,
    defPath: defFile.path
  };
  const screenScale = (H / local[1]) * (parseFloat(stageInfo['xscale']) || 1); /* stage unit -> screen px */
  stage.ss = screenScale;
  reportProgress('sprites');
  const spriteFileName = unquote(bgdef['spr']);
  const spriteBytes = await readFile(spriteFileName);
  if (!spriteBytes) throw new Error('Stage sprite file ' + spriteFileName + ' not found');
  // The stage's animated backgrounds are AIR actions stored in the .def itself.
  stage.pkg = { name: stage.name, sff: await MG.readSff(spriteBytes), acts: {}, air: MG.parseAir(text) };
  for (const sprite of stage.pkg.sff.list) {
    sprite.pin = true;
    sprite.once = true;
  }
  const cameraStartX = bgNums(cameraInfo['startx'], 1, [0])[0];
  stage.camCfg = {
    startx: cameraStartX,
    starty: parseFloat(cameraInfo['starty']) || 0,
    bl: parseFloat(cameraInfo['boundleft']),
    br: parseFloat(cameraInfo['boundright']),
    tension: parseFloat(cameraInfo['tension']) || 50
  };
  if (isNaN(stage.camCfg.bl)) stage.camCfg.bl = -1000;
  if (isNaN(stage.camCfg.br)) stage.camCfg.br = 1000;
  // World width: widest camera bound, plus one screen and a margin on each side.
  const halfWorld = Math.max(Math.abs(stage.camCfg.bl), Math.abs(stage.camCfg.br)) * screenScale + W;
  stage.worldW = Math.ceil(2 * (halfWorld + 400));
  const originX = stage.worldW / 2;
  stage.camMin = originX + stage.camCfg.bl * screenScale - W / 2;
  stage.camMax = originX + stage.camCfg.br * screenScale - W / 2;
  if (stage.camMax < stage.camMin) stage.camMax = stage.camMin;
  stage.ground = clamp((parseFloat(stageInfo['zoffset']) || 0) * screenScale, 120, H - 20);
  if (!parseFloat(stageInfo['zoffset'])) stage.ground = 462;
  const p1StartX = parseFloat(playerInfo['p1startx']),
    p2StartX = parseFloat(playerInfo['p2startx']);
  stage.p1x = originX + (isNaN(p1StartX) ? -70 : p1StartX) * screenScale;
  stage.p2x = originX + (isNaN(p2StartX) ? 70 : p2StartX) * screenScale;
  const leftBound = parseFloat(playerInfo['leftbound']),
    rightBound = parseFloat(playerInfo['rightbound']);
  stage.leftB = originX + (isNaN(leftBound) ? -1000 : leftBound) * screenScale;
  stage.rightB = originX + (isNaN(rightBound) ? 1000 : rightBound) * screenScale;
  const screenLeft = parseFloat(boundInfo['screenleft']),
    screenRight = parseFloat(boundInfo['screenright']);
  stage.edgeL = (isNaN(screenLeft) ? 15 : screenLeft) * screenScale;
  stage.edgeR = (isNaN(screenRight) ? 15 : screenRight) * screenScale;
  const shadowColor = parseNumberList(shadowInfo['color']);
  stage.shadow = {
    rgb: shadowColor.length >= 3 ? shadowColor : [0, 0, 0],
    intensity: shadowInfo['intensity'] !== undefined ? (parseFloat(shadowInfo['intensity']) || 0) / 256 : 0.5,
    yscale: shadowInfo['yscale'] !== undefined ? parseFloat(shadowInfo['yscale']) : 0.4
  };
  stage.autoturn = parseInt(stageInfo['autoturn'] || '1', 10) !== 0;

  /* background elements and BGCtrl definitions, in file order */
  stage.bgs = [];
  stage.ctrlDefs = [];
  let currentCtrlDef = null;
  for (const section of MG.parseIni(text)) {
    const sectionName = section.name.toLowerCase(),
      map = section.map;
    let nameMatch;
    if ((nameMatch = sectionName.match(SECT_BG)) && !/^ctrl/.test(nameMatch[1])) {
      const layerObj = {
        name: nameMatch[1],
        type: (map['type'] || 'normal').toLowerCase(),
        sprite: bgNums(map['spriteno'], 2, [0, 0]),
        id: parseInt(map['id'] || '-1', 10),
        layer: parseInt(map['layerno'] || '0', 10),
        start: bgNums(map['start'], 2, [0, 0]),
        delta: bgNums(map['delta'], 2, [1, 1]),
        trans: (map['trans'] || 'none').toLowerCase(),
        alpha: bgNums(map['alpha'], 2, [256, 256]),
        scale: bgNums(map['scalestart'], 2, [1, 1]),
        tile: bgNums(map['tile'], 2, [0, 0]),
        spacing: bgNums(map['tilespacing'], 2, [0, 0]),
        window: map['window'] ? bgNums(map['window'], 4, [0, 0, 0, 0]) : null,
        vel: bgNums(map['velocity'], 2, [0, 0]),
        sinx: bgNums(map['sin.x'], 3, [0, 0, 0]),
        siny: bgNums(map['sin.y'], 3, [0, 0, 0]),
        width: map['width'] ? bgNums(map['width'], 2, [0, 0]) : null,
        xscale: bgNums(map['xscale'], 2, [1, 1]),
        yscalestart: parseFloat(map['yscalestart'] || '100') / 100,
        yscaledelta: parseFloat(map['yscaledelta'] || '100') / 100,
        action: parseInt(map['actionno'] || '0', 10),
        link: parseInt(map['positionlink'] || '0', 10) !== 0,
        vis: parseInt(map['visible'] || '1', 10) !== 0,
        on: parseInt(map['enabled'] || '1', 10) !== 0,
        mask: parseInt(map['mask'] || '0', 10) !== 0
      };
      // Blended layers need transparency, so they always use the mask.
      if (/^(add|add1|addalpha|sub|subadd)$/.test(layerObj.trans)) layerObj.mask = true;
      // vis0/on0 remember the initial flags for reset(); ox/oy is the accumulated offset; velX/velY the live velocity.
      layerObj.vis0 = layerObj.vis;
      layerObj.on0 = layerObj.on;
      layerObj.ox = 0;
      layerObj.oy = 0;
      layerObj.velX = layerObj.vel[0];
      layerObj.velY = layerObj.vel[1];
      layerObj.t = 0;
      layerObj.sinT = [0, 0];
      layerObj.sinA = [layerObj.sinx.slice(), layerObj.siny.slice()];
      if (layerObj.type === 'anim') {
        layerObj.animation = new MAnim(stage.pkg);
        layerObj.animation.set(layerObj.action);
      }
      stage.bgs.push(layerObj);
    } else if ((nameMatch = sectionName.match(/^bgctrldef\s*(.*)$/))) {
      currentCtrlDef = {
        name: nameMatch[1],
        loop: parseInt(map['looptime'] || '-1', 10),
        ids: (map['ctrlid'] || '')
          .split(',')
          .map(idText => parseInt(idText, 10))
          .filter(idValue => !isNaN(idValue)),
        ctrls: []
      };
      stage.ctrlDefs.push(currentCtrlDef);
    } else if ((nameMatch = sectionName.match(/^bgctrl\s*(.*)$/)) && currentCtrlDef) {
      const timeRange = parseNumberList(map['time'] || '0');
      currentCtrlDef.ctrls.push({
        type: (map['type'] || '').toLowerCase(),
        t0: timeRange[0] || 0,
        t1: timeRange.length > 1 ? timeRange[1] : timeRange[0] || 0,
        ids: (map['ctrlid'] || '')
          .split(',')
          .map(idText => parseInt(idText, 10))
          .filter(idValue => !isNaN(idValue)),
        value: parseNumberList(map['value'] || ''),
        x: parseFloat(map['x']),
        y: parseFloat(map['y']),
        raw: map
      });
    }
  }
  if (!stage.bgs.length) throw new Error('Stage has no [BG] layers');
  // A layer with PositionLink follows the layer defined just before it.
  stage.bgs.forEach((layerObj, index) => {
    if (layerObj.link && index > 0) layerObj.linkTo = stage.bgs[index - 1];
  });

  /* music */
  const musicFileName = unquote(musicInfo['bgmusic'] || '');
  stage.music = null;
  if (musicFileName) {
    const musicBytes = await readFile(musicFileName);
    if (musicBytes)
      stage.music = {
        bytes: new Uint8Array(musicBytes),
        // MUGEN volume is an offset from 100 in percent: convert to a 0..1.5 gain.
        vol:
          musicInfo['bgmvolume'] !== undefined ? clamp((parseFloat(musicInfo['bgmvolume']) + 100) / 100, 0, 1.5) : 0.8
      };
  }
  stage.usedFiles = usedFiles;
  stage.timer = 0;
  stage.netId = MG.netKey('s', defFile.path);

  /* ---------------- runtime ---------------- */

  /** Restores every layer (offset, velocity, visibility, animation) to its initial state. */
  stage.reset = function () {
    stage.timer = 0;
    for (const layerObj of stage.bgs) {
      layerObj.ox = layerObj.oy = 0;
      layerObj.velX = layerObj.vel[0];
      layerObj.velY = layerObj.vel[1];
      layerObj.t = 0;
      layerObj.vis = layerObj.vis0;
      layerObj.on = layerObj.on0;
      layerObj.sinA = [layerObj.sinx.slice(), layerObj.siny.slice()];
      if (layerObj.animation) layerObj.animation.set(layerObj.action);
    }
  };

  /** Advances the stage one tick: runs the BGCtrl controllers, then moves and animates the layers. */
  stage.tick = function () {
    stage.timer++;
    for (const ctrlDef of stage.ctrlDefs) {
      // A BGCtrlDef with LoopTime repeats its timeline.
      const localTime = ctrlDef.loop > 0 ? stage.timer % ctrlDef.loop : stage.timer;
      for (const ctrl of ctrlDef.ctrls) {
        const targetIds = ctrl.ids.length ? ctrl.ids : ctrlDef.ids;
        const active = ctrl.t1 > ctrl.t0 ? localTime >= ctrl.t0 && localTime <= ctrl.t1 : localTime === ctrl.t0,
          continuous = /^(posadd|veladd)$/.test(ctrl.type);
        if (!(active || (continuous && false))) continue;
        for (const layerObj of stage.bgs) {
          if (targetIds.length && targetIds.indexOf(layerObj.id) < 0) continue;
          switch (ctrl.type) {
            case 'visible':
              layerObj.vis = (ctrl.value[0] | 0) !== 0;
              break;
            case 'enable':
              layerObj.on = (ctrl.value[0] | 0) !== 0;
              layerObj.vis = layerObj.on || layerObj.vis;
              break;
            case 'anim':
              if (layerObj.animation) layerObj.animation.set(ctrl.value[0] | 0);
              break;
            case 'posset':
              if (!isNaN(ctrl.x)) layerObj.ox = ctrl.x;
              if (!isNaN(ctrl.y)) layerObj.oy = ctrl.y;
              break;
            case 'posadd':
              if (!isNaN(ctrl.x)) layerObj.ox += ctrl.x;
              if (!isNaN(ctrl.y)) layerObj.oy += ctrl.y;
              break;
            case 'velset':
              if (!isNaN(ctrl.x)) layerObj.velX = ctrl.x;
              if (!isNaN(ctrl.y)) layerObj.velY = ctrl.y;
              break;
            case 'veladd':
              if (!isNaN(ctrl.x)) layerObj.velX += ctrl.x;
              if (!isNaN(ctrl.y)) layerObj.velY += ctrl.y;
              break;
            case 'sinx':
              layerObj.sinA[0] = [ctrl.value[0] || 0, ctrl.value[1] || 0, ctrl.value[2] || 0];
              break;
            case 'siny':
              layerObj.sinA[1] = [ctrl.value[0] || 0, ctrl.value[1] || 0, ctrl.value[2] || 0];
              break;
            case 'removebg':
              layerObj.on = false;
              layerObj.vis = false;
              break;
          }
        }
      }
    }
    for (const layerObj of stage.bgs) {
      if (!layerObj.on) continue;
      layerObj.t++;
      layerObj.ox += layerObj.velX;
      layerObj.oy += layerObj.velY;
      if (layerObj.animation) layerObj.animation.tick();
    }
  };

  /**
   * Position of a layer in stage units: start + offsets, parallax (delta) and optional sine wobble.
   * @param {object} layerObj Background layer.
   * @param {number} cameraX Camera centre in stage units.
   * @returns {number[]} [x, y] in stage units.
   */
  const layerPosition = (layerObj, cameraX) => {
    let offsetX = layerObj.ox,
      offsetY = layerObj.oy;
    const linked = layerObj.linkTo;
    if (linked) {
      offsetX += linked.ox;
      offsetY += linked.oy;
    }
    const sineX = layerObj.sinA[0],
      sineY = layerObj.sinA[1];
    // Sin.X / Sin.Y = [amplitude, period in ticks, phase in degrees].
    if (sineX[0] && sineX[1])
      offsetX += sineX[0] * Math.sin(2 * Math.PI * (layerObj.t / sineX[1]) + ((sineX[2] || 0) * Math.PI) / 180);
    if (sineY[0] && sineY[1])
      offsetY += sineY[0] * Math.sin(2 * Math.PI * (layerObj.t / sineY[1]) + ((sineY[2] || 0) * Math.PI) / 180);
    return [layerObj.start[0] + offsetX - cameraX * layerObj.delta[0], layerObj.start[1] + offsetY];
  };

  /**
   * Draws one background layer (normal, anim or parallax), including tiling, window clip and blend mode.
   * @param {CanvasRenderingContext2D} ctx Target canvas context.
   * @param {object} layerObj Background layer.
   * @param {number} cameraLeft World x of the left edge of the screen.
   */
  const drawLayer = (ctx, layerObj, cameraLeft) => {
    let spriteGroup = layerObj.sprite[0],
      spriteImage = layerObj.sprite[1],
      frameOffsetX = 0,
      frameOffsetY = 0,
      flipH = false,
      flipV = false,
      frame = null;
    if (layerObj.type === 'anim') {
      frame = layerObj.animation.frame();
      if (!frame) return;
      spriteGroup = frame.g;
      spriteImage = frame.i;
      frameOffsetX = frame.x;
      frameOffsetY = frame.y;
      flipH = frame.fh;
      flipV = frame.fv;
    }
    const sprite = stage.pkg.sff.sprites.get(spriteGroup + ',' + spriteImage);
    if (!sprite) return;
    const spriteCanvas = MG.spriteCanvas(stage.pkg, sprite, 1, !layerObj.mask);
    if (!spriteCanvas) return;
    const cameraX = (cameraLeft + W / 2 - stage.worldW / 2) / screenScale;
    const [posX, posY] = layerPosition(layerObj, cameraX);
    ctx.save();
    if (layerObj.window) {
      ctx.beginPath();
      ctx.rect(
        layerObj.window[0] * screenScale,
        layerObj.window[1] * screenScale,
        (layerObj.window[2] - layerObj.window[0] + 1) * screenScale,
        (layerObj.window[3] - layerObj.window[1] + 1) * screenScale
      );
      ctx.clip();
    }
    // Map the MUGEN transparency mode to a canvas blend mode.
    const transMode = layerObj.trans;
    if (transMode === 'add' || transMode === 'add1') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = transMode === 'add1' ? 0.5 : 1;
    } else if (transMode === 'addalpha') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(layerObj.alpha[0] / 256, 0, 1);
      if (ctx.globalAlpha <= 0) {
        ctx.restore();
        return;
      }
    } else if (transMode === 'sub' || transMode === 'subadd') ctx.globalCompositeOperation = 'difference';
    ctx.imageSmoothingEnabled = false;
    const spriteW = sprite.w,
      spriteH = sprite.h,
      axisX = sprite.ax,
      axisY = sprite.ay,
      scaleX = layerObj.scale[0],
      scaleY = layerObj.scale[1];
    const tileX = layerObj.tile[0],
      tileY = layerObj.tile[1],
      tileStepX = (spriteW + layerObj.spacing[0]) * screenScale * Math.abs(scaleX),
      tileStepY = (spriteH + layerObj.spacing[1]) * screenScale * Math.abs(scaleY);
    const baseX = W / 2 + (posX + frameOffsetX) * screenScale,
      baseY = (posY + frameOffsetY) * screenScale;
    if (layerObj.type === 'parallax') {
      /* each row of the sprite is scaled horizontally, from the top width to the bottom width */
      const topWidth = layerObj.width ? layerObj.width[0] : spriteW * layerObj.xscale[0],
        bottomWidth = layerObj.width ? layerObj.width[1] : spriteW * layerObj.xscale[1];
      /* rows are drawn in bands (neighbouring rows differ by a fraction of a pixel) and rows outside the screen are skipped */
      const widthChangePerRow = (Math.abs(bottomWidth - topWidth) * screenScale) / Math.max(1, spriteH),
        bandHeight = widthChangePerRow < 0.01 ? 8 : Math.max(1, Math.min(8, Math.floor(1.5 / widthChangePerRow)));
      for (let row = 0; row < spriteH; row += bandHeight) {
        const rowsInBand = Math.min(bandHeight, spriteH - row),
          rowFraction = spriteH > 1 ? (row + rowsInBand / 2) / spriteH : 0,
          rowWidth = (topWidth + (bottomWidth - topWidth) * rowFraction) * screenScale,
          rowScale = rowWidth / spriteW,
          rowY = baseY + (row - axisY) * screenScale;
        if (rowY > H || rowY + rowsInBand * screenScale + 1 < 0) continue;
        const rowStep = (spriteW + layerObj.spacing[0]) * rowScale;
        const originLeft = W / 2 + ((posX + frameOffsetX) * screenScale * rowScale) / screenScale - axisX * rowScale;
        let firstX = originLeft;
        if (tileX !== 0 && rowStep > 1) {
          firstX = originLeft - Math.ceil(originLeft / rowStep) * rowStep;
        }
        const copies = tileX === 0 ? 1 : tileX === 1 ? Math.ceil((W - firstX) / Math.max(1, rowStep)) + 1 : tileX;
        for (let copy = 0; copy < copies; copy++)
          ctx.drawImage(
            spriteCanvas,
            0,
            row,
            spriteW,
            rowsInBand,
            firstX + copy * rowStep,
            rowY,
            spriteW * rowScale,
            rowsInBand * screenScale + 0.6
          );
      }
    } else {
      const flipSignX = (flipH ? -1 : 1) * Math.sign(scaleX || 1),
        flipSignY = (flipV ? -1 : 1) * Math.sign(scaleY || 1),
        drawW = spriteW * screenScale * Math.abs(scaleX),
        drawH = spriteH * screenScale * Math.abs(scaleY);
      let originX0 = baseX - axisX * screenScale * scaleX,
        originY0 = baseY - axisY * screenScale * scaleY;
      let countX = 1,
        countY = 1,
        startX = originX0,
        startY = originY0;
      // Tile = 1 repeats forever (just enough copies to cover the screen); larger values are an exact count.
      if (tileX === 1) {
        startX = originX0 - Math.ceil(originX0 / tileStepX) * tileStepX;
        countX = Math.ceil((W - startX) / tileStepX) + 1;
      } else if (tileX > 1) countX = tileX;
      if (tileY === 1) {
        startY = originY0 - Math.ceil(originY0 / tileStepY) * tileStepY;
        countY = Math.ceil((H - startY) / tileStepY) + 1;
      } else if (tileY > 1) countY = tileY;
      for (let tileRow = 0; tileRow < countY; tileRow++)
        for (let tileCol = 0; tileCol < countX; tileCol++) {
          const drawX = startX + tileCol * tileStepX,
            drawY = startY + tileRow * tileStepY;
          if (drawX > W || drawY > H || drawX + drawW < 0 || drawY + drawH < 0) continue;
          if (flipSignX < 0 || flipSignY < 0) {
            ctx.save();
            ctx.translate(drawX + (flipSignX < 0 ? drawW : 0), drawY + (flipSignY < 0 ? drawH : 0));
            ctx.scale(flipSignX, flipSignY);
            ctx.drawImage(spriteCanvas, 0, 0, drawW, drawH);
            ctx.restore();
          } else ctx.drawImage(spriteCanvas, drawX, drawY, drawW, drawH);
        }
    }
    ctx.restore();
  };

  /* layers below 1 are drawn behind the fighters (lowest first), layers 1 and up in front of them */
  const drawOrder = stage.bgs
    .map((layerObj, index) => [layerObj, index])
    .sort((first, second) => first[0].layer - second[0].layer || first[1] - second[1])
    .map(pair => pair[0]);

  /**
   * Draws all visible layers of one side of the fighters.
   * @param {CanvasRenderingContext2D} ctx Target canvas context.
   * @param {number} cam World x of the left edge of the screen.
   * @param {boolean} front True for the layers drawn in front of the fighters, false for behind.
   */
  stage.drawLayer = function (ctx, cam, front) {
    for (const layerObj of drawOrder)
      if (layerObj.on && layerObj.vis && layerObj.layer >= 1 === front && layerObj.type !== 'dummy')
        drawLayer(ctx, layerObj, cam);
  };

  /** Clears the screen and draws the layers behind the fighters. */
  stage.drawBack = function (ctx, cam) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    stage.drawLayer(ctx, cam, false);
  };

  /** Draws the layers in front of the fighters. */
  stage.drawFront = function (ctx, cam) {
    stage.drawLayer(ctx, cam, true);
  };
  return stage;
};
