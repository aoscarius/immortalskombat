/* =====================================================================
   File format test: SFF v1 (PCX) and v2 decode to identical pixels; every
   SND sound decodes.
   ===================================================================== */
const cp = require('child_process'),
  { ROOT, open, pass } = require('./lib');
(async () => {
  cp.execFileSync('python3', ['tests/make_v1.py'], { cwd: ROOT, stdio: 'ignore' });
  const page = await open('file://' + ROOT + '/dist/immortals-kombat.html');
  await page.click('[data-act=versus]');
  await page.setInputFiles('#mg-dir', ROOT + '/tests/out/kaelith_v1');
  await page.waitForFunction(() => IK.CHARS.length === 2, null, { timeout: 15000 });
  const result = await page.evaluate(async () => {
    for (const ch of IK.CHARS) await IK.Roster.loadChar(ch);
    const pkgV1 = IK.CHARS.find(ch => ch.mugen.sff.ver === 1).mugen,
      pkgV2 = IK.CHARS.find(ch => ch.mugen.sff.ver === 2).mugen;
    let sameCount = 0;
    const mismatches = [];
    /** Pixel data of a sprite as a comma separated string (null when it cannot be drawn). */
    const pixelsOf = (pkg, sprite) => {
      const canvas = MG.spriteCanvas(pkg, sprite, 1);
      return canvas ? canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.join(',') : null;
    };
    for (const [spriteKey, spriteV2] of pkgV2.sff.sprites) {
      const spriteV1 = pkgV1.sff.sprites.get(spriteKey);
      if (
        spriteV1 &&
        spriteV1.w === spriteV2.w &&
        spriteV1.h === spriteV2.h &&
        pixelsOf(pkgV1, spriteV1) === pixelsOf(pkgV2, spriteV2)
      )
        sameCount++;
      else mismatches.push(spriteKey);
    }
    Snd.init();
    await Snd.ctx.resume();
    let decodedCount = 0,
      soundCount = 0;
    for (const sound of pkgV2.snd.values()) {
      soundCount++;
      if (await Snd.decode(sound)) decodedCount++;
    }
    return {
      sprites: pkgV2.sff.sprites.size,
      same: sameCount,
      bad: mismatches.slice(0, 5),
      sounds: soundCount,
      decoded: decodedCount
    };
  });
  pass(
    'SFF v1 and v2 give the same pixels',
    result.same === result.sprites && result.bad.length === 0,
    JSON.stringify(result)
  );
  pass('all SND sounds decode', result.decoded === result.sounds && result.sounds > 0);
  pass('no page errors', page.errs.length === 0, page.errs.join('; '));
  await page.close2();
})();
