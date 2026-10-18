/* =====================================================================
   Memory test over repeated matches: heap and sprite cache must stay flat;
   the cache must be empty at the menu. Needs MUGEN_REF content for extra
   stages.
   ===================================================================== */
const fs = require('fs'),
  path = require('path'),
  { ROOT, REF, serve, open, pass } = require('./lib');
(async () => {
  const server = await serve(path.join(ROOT, 'dist'), 0),
    page = await open(server.url + 'immortals-kombat.html');
  if (fs.existsSync(path.join(REF, 'stages'))) {
    await page.click('[data-act=versus]');
    for (const folder of ['chars/kfm720', 'stages']) {
      await page.setInputFiles('#mg-dir', path.join(REF, folder));
      await page.waitForTimeout(2200);
    }
  }
  const result = await page.evaluate(async () => {
    /** Used JS heap in MB. */
    const heapMB = () => Math.round(performance.memory.usedJSHeapSize / 1048576),
      /** Promise that resolves after `milliseconds`. */
      wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
      kaelith = IK.CHARS.find(ch => ch.name === 'Kaelith'),
      otherFighter = IK.CHARS.find(ch => ch.name !== 'Kaelith') || kaelith,
      heaps = [];
    for (let round = 0; round < 3; round++) {
      for (const stageRecord of IK.STAGES) {
        await IK.Match.begin('practice', otherFighter, kaelith, stageRecord, 0);
        await wait(1500);
      }
      heaps.push(heapMB());
    }
    const cacheMB = MG.cache.bytes / 1048576;
    IK.toMenu();
    await wait(300);
    return {
      stages: IK.STAGES.length,
      heaps,
      peakCacheMB: +cacheMB.toFixed(1),
      menuCache: MG.cache.bytes,
      menuEntries: MG.cache.list.length
    };
  });
  pass('heap does not grow round after round', result.heaps[2] <= result.heaps[0] * 1.5 + 10, JSON.stringify(result));
  pass('sprite cache stays under its budget', result.peakCacheMB <= 96, result.peakCacheMB + ' MB');
  pass('cache is empty at the menu', result.menuCache === 0 && result.menuEntries === 0);
  pass('no page errors', page.errs.length === 0, page.errs.join('; '));
  await page.close2();
  server.stop();
})();
