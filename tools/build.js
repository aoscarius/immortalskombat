#!/usr/bin/env node
/**
 * Build script for the game.
 *
 * Usage:  node tools/build.js [--dev]
 * Needs:  Node.js plus the npm packages `jszip` (via make-zips.js) and `terser` (minification).
 *
 * Produces, in dist/:
 *   immortals-kombat.html  one self-contained page (all CSS and JS inlined, minified unless --dev)
 *   artifact.html          the same page as an HTML fragment (for hosts that wrap the page themselves)
 *   assets/                the default content folder: one zip per character and stage, plus manifest.json
 *
 * The bundle that is inlined into the page also contains assets/packs.js, the loose content used when
 * the page cannot read a content folder (opened from file://).
 */
const fs = require('fs'),
  path = require('path'),
  childProcess = require('child_process');

const projectRoot = path.join(__dirname, '..');

/** Reads a UTF-8 text file given relative to the project root. */
const readProjectFile = relativePath => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

/** Runs another script of tools/ in a child Node process, inheriting stdio (output is shown live). */
const runTool = (scriptName, ...args) =>
  childProcess.execFileSync('node', [path.join(__dirname, scriptName), ...args], { stdio: 'inherit' });

/** True when `--dev` was passed: skip minification. */
const devMode = process.argv.includes('--dev');

(async () => {
  /* 1. content: zips -> assets/, loose bundle -> assets/packs.js */
  runTool('make-zips.js');
  runTool('pack-assets.js');

  /* 2. page: scripts in the order index.html lists them */
  const indexHtml = readProjectFile('index.html'),
    stylesheet = readProjectFile('css/style.css');
  // Local <script src="js/..."> / <script src="assets/..."> tags, in document order.
  const localScriptPaths = [...indexHtml.matchAll(/<script src="((?:js|assets)\/[^"]+)"><\/script>/g)].map(
    match => match[1]
  );
  let bundledScript = localScriptPaths
    .map(scriptPath => '/* ---- ' + scriptPath + ' ---- */\n' + readProjectFile(scriptPath))
    .join('\n');
  if (!devMode) {
    const minified = await require('terser').minify(bundledScript, {
      compress: { passes: 2 },
      mangle: { toplevel: false },
      format: { comments: false }
    });
    if (minified.error) throw minified.error;
    bundledScript = minified.code;
  }
  // External (https) deferred scripts and Google Fonts links are copied verbatim into the head.
  const externalScriptTags = [...indexHtml.matchAll(/<script src="(https:[^"]+)" defer><\/script>/g)]
    .map(match => match[0])
    .join('\n');
  const fontLinkTags = [...indexHtml.matchAll(/<link [^>]*(?:preconnect|fonts\.googleapis\.com\/css2)[^>]*>/g)]
    .map(match => match[0])
    .join('\n');
  // Page body markup: everything between <body> and the "engine" marker comment.
  const bodyMarkup = indexHtml.slice(indexHtml.indexOf('<body>') + 6, indexHtml.indexOf('<!-- engine -->')).trim();
  const headMarkup =
    '<title>Immortals Kombat</title>\n' +
    fontLinkTags +
    '\n' +
    externalScriptTags +
    '\n<style>\n' +
    stylesheet +
    '</style>\n';
  fs.mkdirSync(path.join(projectRoot, 'dist'), { recursive: true });
  // Fragment version (no <html>/<head>/<body> wrapper).
  fs.writeFileSync(
    path.join(projectRoot, 'dist/artifact.html'),
    headMarkup + bodyMarkup + '\n<script>\n' + bundledScript + '\n</script>\n'
  );
  // Full standalone page.
  const fullPage =
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' +
    headMarkup +
    '</head>\n<body>\n' +
    bodyMarkup +
    '\n<script>\n' +
    bundledScript +
    '\n</script>\n</body>\n</html>\n';
  fs.writeFileSync(path.join(projectRoot, 'dist/immortals-kombat.html'), fullPage);

  /* 3. the default content folder travels next to the page */
  const distAssetsDir = path.join(projectRoot, 'dist/assets');
  fs.rmSync(distAssetsDir, { recursive: true, force: true });
  // packs.js is already inlined in the page, so it is not copied.
  fs.cpSync(path.join(projectRoot, 'assets'), distAssetsDir, {
    recursive: true,
    filter: sourcePath => !/packs\.js$/.test(sourcePath)
  });
  runTool('make-manifest.js', distAssetsDir);
  console.log(
    'dist/immortals-kombat.html',
    Math.round(fullPage.length / 1024) + ' KB' + (devMode ? ' (dev, not minified)' : '')
  );
})().catch(error => {
  console.error(error);
  process.exit(1);
});
