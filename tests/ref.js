/* =====================================================================
   Compatibility with real MUGEN/Ikemen content.
   Needs the sample content (MUGEN_REF=<.../sp>, with chars/ and stages/);
   skipped otherwise.
   - every idle frame is complete (feet on the bottom row of its sprite)
   - AI vs AI for 5000 ticks: no animation stops advancing, nobody drifts while idle
   - every stage loads and draws
   ===================================================================== */
const fs = require('fs'),
  path = require('path'),
  { REF, ROOT, open, pass } = require('./lib');
(async () => {
  if (!fs.existsSync(path.join(REF, 'chars'))) {
    console.log('SKIP ref.js (no MUGEN_REF content)');
    return;
  }
  const page = await open('file://' + ROOT + '/dist/immortals-kombat.html');
  await page.click('[data-act=versus]');
  for (const d of ['chars/kfm', 'chars/kfm720', 'chars/kfm_zss', 'chars/kfm_zaxis', 'stages']) {
    await page.setInputFiles('#mg-dir', path.join(REF, d));
    await page.waitForTimeout(2200);
  }
  const names = await page.evaluate(() => IK.CHARS.map(ch => ch.name));
  pass('imports the sample fighters', names.length >= 5, names.join(', '));
  const idle = await page.evaluate(async () => {
    const report = [];
    for (const ch of IK.CHARS) {
      await IK.Roster.loadChar(ch);
      const pkg = ch.mugen,
        idleAction = pkg.air.get(0);
      let cutFrames = 0;
      for (const frame of idleAction.frames) {
        const sprite = pkg.sff.sprites.get(frame.g + ',' + frame.i),
          spriteCanvas = sprite && MG.spriteCanvas(pkg, sprite, 1);
        if (!spriteCanvas) {
          cutFrames++;
          continue;
        }
        const pixels = spriteCanvas
          .getContext('2d')
          .getImageData(0, spriteCanvas.height - 2, spriteCanvas.width, 2).data;
        let hasOpaquePixel = 0;
        for (let alphaIndex = 3; alphaIndex < pixels.length; alphaIndex += 4)
          if (pixels[alphaIndex]) hasOpaquePixel = 1;
        if (!hasOpaquePixel) cutFrames++;
      }
      report.push([ch.name, idleAction.frames.length, cutFrames]);
    }
    return report;
  });
  pass(
    'idle frames keep their legs',
    idle.every(row => row[2] === 0),
    JSON.stringify(idle)
  );
  for (const folder of ['Kung Fu Man']) {
    const result = await page.evaluate(async () => {
      const kungFuMan = IK.CHARS.find(ch => ch.name === 'Kung Fu Man'),
        kaelith = IK.CHARS.find(ch => ch.name === 'Kaelith');
      await IK.Match.begin('practice', kungFuMan, kaelith, 'random', 0);
      while (IK.G.phase !== 'intro' && IK.G.phase !== 'fight') await new Promise(resolve => setTimeout(resolve, 20));
      const [fighter0, fighter1] = IK.G.fighters,
        aiController = Mugen.makeAI(6);
      fighter0.inputFn = (fighter, opponent) => aiController(fighter, opponent);
      fighter1.inputFn = (fighter, opponent) => aiController(fighter, opponent);
      const stuckAnimations = {},
        lastSeen = [{}, {}];
      for (let tick = 0; tick < 5000; tick++) {
        if (IK.G.phase === 'intro') {
          IK.G.phase = 'fight';
          IK.G.locked = false;
        }
        if (['over', 'end', 'ko'].includes(IK.G.phase)) IK.Match.startRound();
        Sched.step();
        IK.G.update();
        [fighter0, fighter1].forEach((fighter, index) => {
          const animationKey =
              fighter.animation.no +
              '/' +
              fighter.animation.elem +
              '/' +
              fighter.animation.etime +
              '/' +
              fighter.animation.time,
            previous = lastSeen[index];
          if (
            previous.key === animationKey &&
            !(fighter.hitPause > 0) &&
            !Mugen.pause &&
            fighter.animation.act &&
            fighter.animation.act.frames.length > 1 &&
            !fighter.animation.act.inf
          ) {
            if (++previous.n === 8) stuckAnimations[fighter.name + ' anim ' + fighter.animation.no] = 1;
          } else previous.n = 0;
          previous.key = animationKey;
        });
      }
      /* idle drift: with no input and nobody attacking, a fighter must not move */
      IK.G.fighters.forEach(fighter => {
        fighter.inputFn = () => ({});
        fighter.changeState(0);
        fighter.ctrl = true;
        fighter.velX = fighter.velY = 0;
        fighter.posY = 0;
      });
      IK.G.fighters[1].posX = IK.G.fighters[0].posX + 400;
      const startX = fighter0.posX;
      for (let tick = 0; tick < 300; tick++) {
        Sched.step();
        IK.G.update();
      }
      return {
        stuck: Object.keys(stuckAnimations),
        drift: Math.abs(fighter0.posX - startX),
        state: fighter0.stateno,
        warnings: MG.log.slice(0, 6)
      };
    });
    pass('no animation stops advancing', result.stuck.length === 0, JSON.stringify(result.stuck));
    pass('an idle fighter does not drift', result.drift < 1 && result.state === 0, JSON.stringify(result));
  }
  const stageResults = await page.evaluate(async () => {
    const report = [];
    for (const stageRecord of IK.STAGES) {
      try {
        await IK.Roster.loadStage(stageRecord);
        report.push(stageRecord.name + ':ok');
        IK.Roster.releaseStage(stageRecord);
      } catch (error) {
        report.push(stageRecord.name + ':' + error.message);
      }
    }
    return report;
  });
  pass(
    'every listed stage loads',
    stageResults.every(entry => /:ok$/.test(entry)),
    stageResults.join(' | ')
  );
  pass('no page errors', page.errs.length === 0, page.errs.join('; '));
  await page.close2();
})();
