/* =====================================================================
   Smoke test from file:// (bundled content): boot, start a practice match,
   move, attack, cast a special, debug keys.
   ===================================================================== */
const path = require('path'),
  { ROOT, open, pass } = require('./lib');
(async () => {
  const page = await open('file://' + ROOT + '/dist/immortals-kombat.html');
  pass(
    'boots with the bundled fighter and stage',
    await page.evaluate(() => IK.CHARS.length === 1 && IK.STAGES.length === 1 && IK.Content.how === 'bundled')
  );
  await page.click('[data-act=practice]');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    IK.Sel.c[0] = 0;
    IK.Sel.confirm(0);
  });
  await page.waitForFunction(() => IK.G.phase === 'fight', null, { timeout: 20000 });
  const startX = await page.evaluate(() => IK.G.fighters[0].posX);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyD');
  pass('walks forward', await page.evaluate(x => IK.G.fighters[0].posX > x + 5, startX));
  for (const keyCode of ['KeyJ', 'KeyK', 'KeyN', 'KeyM']) {
    await page.keyboard.press(keyCode, { delay: 60 });
    await page.waitForTimeout(350);
  }
  /* quarter-circle forward + X: Frost Orb */
  await page.evaluate(() => {
    window.__seen = new Set();
    const fighter = IK.G.fighters[0];
    const originalChangeState = fighter.changeState.bind(fighter);
    fighter.changeState = (stateNumber, owner) => {
      __seen.add(stateNumber);
      return originalChangeState(stateNumber, owner);
    };
  });
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(60);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(60);
  await page.keyboard.up('KeyS');
  await page.waitForTimeout(60);
  await page.keyboard.press('KeyJ', { delay: 60 });
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyD');
  const visitedStates = await page.evaluate(() => [...__seen]);
  pass(
    'fires a special move',
    visitedStates.some(stateNumber => stateNumber >= 1000 && stateNumber < 3000),
    'states: ' + visitedStates.join(',')
  );
  /* debug keys: Space refills life and power, F2 leaves the CPU opponent at 1 life */
  await page.evaluate(() => {
    const fighter = IK.G.fighters[0];
    fighter.life = 10;
    fighter.power = 0;
  });
  await page.keyboard.press('Space', { delay: 60 });
  await page.waitForTimeout(100);
  pass(
    'Space refills life and power',
    await page.evaluate(() => {
      const fighter = IK.G.fighters[0];
      return fighter.life === fighter.maxHp && fighter.power === fighter.powerMax;
    })
  );
  await page.keyboard.press('F2', { delay: 60 });
  await page.waitForTimeout(100);
  pass('F2 puts the CPU opponent at 1 life', await page.evaluate(() => IK.G.fighters[1].life === 1));
  await page.screenshot({ path: path.join(__dirname, 'out', 'smoke.png') });
  pass('no page errors', page.errs.length === 0, page.errs.join('; '));
  await page.close2();
})();
