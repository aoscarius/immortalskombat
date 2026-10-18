/**
 * Development helper: renders the original sprite atlas of the early prototype page
 * (<scratchpad>/ik/page.html) to PNG files under <scratchpad>/pack/png/ using headless Chromium.
 *
 * Usage: node tools/render-sprites.js
 * Needs: the `playwright` package with a Chromium browser, and the prototype page
 *        (which defines the globals CHARS, POSES and Atlas) at the hard-coded scratchpad path below.
 * Not part of the build and not used by the game or the tests.
 */
const { chromium } = require('playwright');
const fs = require('fs');

const scratchRoot = '/tmp/claude-0/-home-claude/1a5e777b-b8c6-5630-a0f1-a78834d6bd37/scratchpad/';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  await page.goto('file://' + scratchRoot + 'ik/page.html');
  await page.waitForTimeout(500);
  // Runs in the browser: draws every pose plus a few extra images and returns them as PNG data URLs.
  const rendered = await page.evaluate(() => {
    const character = CHARS[0],
      result = { poses: {}, extra: {} };
    for (const poseName of Object.keys(POSES))
      result.poses[poseName] = Atlas.get(character, poseName).toDataURL('image/png');
    // Energy orb: radial gradient, white core fading to transparent cyan.
    const orbCanvas = document.createElement('canvas');
    orbCanvas.width = orbCanvas.height = 64;
    const orbContext = orbCanvas.getContext('2d');
    const gradient = orbContext.createRadialGradient(32, 32, 0, 32, 32, 30);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.35, '#7fe0ff');
    gradient.addColorStop(1, '#7fe0ff00');
    orbContext.fillStyle = gradient;
    orbContext.beginPath();
    orbContext.arc(32, 32, 30, 0, 7);
    orbContext.fill();
    result.extra.orb = orbCanvas.toDataURL();
    // Small and large character portraits.
    const smallPortrait = document.createElement('canvas');
    smallPortrait.width = smallPortrait.height = 96;
    Atlas.portrait(smallPortrait, character, true);
    result.extra.port = smallPortrait.toDataURL();
    const bigPortrait = document.createElement('canvas');
    bigPortrait.width = 120;
    bigPortrait.height = 140;
    Atlas.portrait(bigPortrait, character, false);
    result.extra.big = bigPortrait.toDataURL();
    return result;
  });
  /** Writes a data URL as pack/png/<name>.png. */
  const writePng = (name, dataUrl) =>
    fs.writeFileSync(scratchRoot + 'pack/png/' + name + '.png', Buffer.from(dataUrl.split(',')[1], 'base64'));
  for (const poseName in rendered.poses) writePng(poseName, rendered.poses[poseName]);
  for (const extraName in rendered.extra) writePng('x_' + extraName, rendered.extra[extraName]);
  console.log(Object.keys(rendered.poses).length, 'poses');
  await browser.close();
})();
