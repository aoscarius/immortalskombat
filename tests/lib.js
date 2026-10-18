/* =====================================================================
   Shared helpers for the browser tests: serve(), open(), pass().
   ===================================================================== */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.join(__dirname, '..'),
  REF = process.env.MUGEN_REF || path.join(ROOT, '..', 'ref', 'sp');
/**
 * Starts tools/serve.js on a port.
 * @param {string} [dir] folder to serve (default: dist)
 * @param {number} port port number (0 = any free port)
 * @returns {Promise<{url: string, stop: Function}>} base URL and a stop function
 */
async function serve(dir, port) {
  const server = spawn('node', [path.join(ROOT, 'tools', 'serve.js'), dir || path.join(ROOT, 'dist'), String(port)], {
    stdio: ['ignore', 'pipe', 'inherit']
  });
  const firstLine = await new Promise(resolve => server.stdout.once('data', chunk => resolve(String(chunk)))),
    actualPort = +firstLine.match(/localhost:(\d+)/)[1];
  process.on('exit', () => server.kill());
  return { url: 'http://localhost:' + actualPort + '/', stop: () => server.kill() };
}
/**
 * Opens a browser page that cannot reach the internet (tests must not depend on CDNs) and collects page errors.
 * The page gets `errs` (error messages) and `close2()` (closes the browser).
 * @param {string} url page address
 * @param {{viewport?: object, init?: Function, expose?: object}} [options] viewport size, init script, Node functions to expose
 * @returns {Promise<object>} the Playwright page, ready once window.IK.ready is set
 */
async function open(url, options) {
  options = options || {};
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required']
  });
  const page = await browser.newPage({ viewport: options.viewport || { width: 1000, height: 640 } });
  page.errs = [];
  if (options.init) await page.addInitScript(options.init); /* script run before the page's own */
  for (const [name, nodeFunction] of Object.entries(options.expose || {}))
    await page.exposeFunction(name, nodeFunction); /* node functions callable from the page */
  page.on('pageerror', error => page.errs.push(error.message));
  await page.route(/^https?:\/\/(?!localhost)/, route =>
    /jszip/.test(route.request().url())
      ? route.fulfill({ path: path.join(ROOT, 'node_modules/jszip/dist/jszip.min.js'), contentType: 'text/javascript' })
      : route.abort()
  ); /* JSZip is served from node_modules */
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.IK && IK.ready, null, { timeout: 20000 });
  page.close2 = () => browser.close();
  return page;
}
/**
 * Prints one PASS / FAIL line and sets a failing exit code on failure.
 * @param {string} name test name
 * @param {boolean} passed result of the check
 * @param {string} [extra] details printed after the name
 */
const pass = (name, passed, extra) => {
  console.log((passed ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));
  if (!passed) process.exitCode = 1;
};
module.exports = { ROOT, REF, serve, open, pass };
