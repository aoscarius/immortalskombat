/* =====================================================================
   Content folder test: zips and manifest, directory-index crawl, bundled
   fallback, lazy load and release of fighters and stages.
   ===================================================================== */
const fs = require('fs'),
  path = require('path'),
  { ROOT, serve, open, pass } = require('./lib');
(async () => {
  const dist = path.join(ROOT, 'dist'),
    server = await serve(dist, 0);
  for (const folder of ['assets2', 'assets3']) fs.rmSync(path.join(dist, folder), { recursive: true, force: true });
  fs.cpSync(path.join(dist, 'assets'), path.join(dist, 'assets2'), { recursive: true });
  fs.rmSync(path.join(dist, 'assets2/manifest.json')); /* zips, no manifest: crawl */
  fs.mkdirSync(path.join(dist, 'assets3/chars/kaelith'), { recursive: true });
  for (const fileName of fs.readdirSync(path.join(ROOT, 'content-src/chars/kaelith')))
    fs.copyFileSync(
      path.join(ROOT, 'content-src/chars/kaelith', fileName),
      path.join(dist, 'assets3/chars/kaelith', fileName)
    ); /* loose folder, no manifest */
  const page = await open(server.url + 'immortals-kombat.html');
  /** Reads the roster state (loaded flags, content mode, sprite cache bytes) from the page. */
  const readState = () =>
    page.evaluate(() => ({
      chars: IK.CHARS.map(ch => ch.name + ':' + ch.mugen.loaded),
      stages: IK.STAGES.map(stageRecord => stageRecord.name + ':' + !!stageRecord.st),
      how: IK.Content.how,
      cache: MG.cache.bytes
    }));
  let state = await readState();
  pass(
    'manifest lists a zipped fighter and stage',
    state.how === 'manifest' && state.chars[0] === 'Kaelith:false' && state.stages[0] === 'Ashen Gate:false',
    JSON.stringify(state)
  );
  await page.click('[data-act=practice]');
  await page.waitForFunction(() => Thumbs.cache.size > 0, null, { timeout: 10000 });
  pass('thumbnail made without loading the fighter', !(await readState()).chars[0].endsWith('true'));
  await page.evaluate(() => {
    IK.Sel.c[0] = 0;
    IK.Sel.confirm(0);
  });
  await page.waitForFunction(() => IK.G.phase === 'fight', null, { timeout: 20000 });
  state = await readState();
  pass(
    'picked fighter and stage are loaded for the match',
    state.chars[0] === 'Kaelith:true' && state.stages[0] === 'Ashen Gate:true' && state.cache > 0
  );
  await page.screenshot({ path: path.join(__dirname, 'out', 'base_fight.png') });
  await page.evaluate(() => IK.toMenu());
  await page.waitForTimeout(300);
  state = await readState();
  pass(
    'everything is released at the menu',
    state.chars[0] === 'Kaelith:false' && state.stages[0] === 'Ashen Gate:false' && state.cache === 0
  );
  await page.click('[data-act=roster]');
  for (const [baseUrl, expectedMode, label] of [
    ['assets2/', 'directory index', 'zips found by crawling a folder index'],
    ['assets3/', 'directory index', 'loose folder found by crawling']
  ]) {
    await page.fill('#base-url', baseUrl);
    await page.click('#base-load');
    await page
      .waitForFunction(mode => IK.Content.how === mode && IK.CHARS.length > 0, expectedMode, { timeout: 15000 })
      .catch(() => {});
    state = await readState();
    pass(
      label,
      state.how === expectedMode && state.chars.length >= 1 && /Kaelith/i.test(state.chars[0]),
      JSON.stringify(state.chars)
    );
  }
  await page.fill('#base-url', 'nope/');
  await page.click('#base-load');
  await page.waitForFunction(() => IK.Content.how === 'bundled', null, { timeout: 15000 }).catch(() => {});
  state = await readState();
  pass('unreadable folder falls back to bundled content', state.how === 'bundled' && state.chars.length === 1);
  pass('no page errors', page.errs.length === 0, page.errs.join('; '));
  await page.close2();
  server.stop();
  for (const folder of ['assets2', 'assets3']) fs.rmSync(path.join(dist, folder), { recursive: true, force: true });
})();
