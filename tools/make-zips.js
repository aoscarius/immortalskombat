#!/usr/bin/env node
/**
 * Zips every character and stage folder of content-src/ into the default content folder:
 *   content-src/chars/<name>/...   ->  assets/chars/<name>.zip   (one zip per character)
 *   content-src/stages/<name>/...  ->  assets/stages/<name>.zip  (one zip per stage)
 * Each zip holds one top-level folder, the usual way MUGEN characters are distributed.
 *
 * Usage: node tools/make-zips.js   (also run by tools/build.js)
 * Needs: the npm package `jszip`.
 */
const fs = require('fs'),
  path = require('path'),
  JSZip = require('jszip');

const sourceDir = path.join(__dirname, '..', 'content-src'),
  outputDir = path.join(__dirname, '..', 'assets');

/**
 * Recursively adds every file under `directory` to the zip.
 * @param {JSZip} zip archive being filled
 * @param {string} directory absolute directory to add
 * @param {string} zipPath path of that directory inside the archive
 */
const addDirectoryToZip = (zip, directory, zipPath) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const diskPath = path.join(directory, entry.name),
      entryZipPath = zipPath + '/' + entry.name;
    if (entry.isDirectory()) addDirectoryToZip(zip, diskPath, entryZipPath);
    else zip.file(entryZipPath, fs.readFileSync(diskPath));
  }
};

(async () => {
  // Start from a clean slate so removed content does not linger.
  fs.rmSync(path.join(outputDir, 'chars'), { recursive: true, force: true });
  fs.rmSync(path.join(outputDir, 'stages'), { recursive: true, force: true });
  for (const kind of ['chars', 'stages']) {
    const kindDir = path.join(sourceDir, kind);
    if (!fs.existsSync(kindDir)) continue;
    fs.mkdirSync(path.join(outputDir, kind), { recursive: true });
    for (const name of fs.readdirSync(kindDir)) {
      if (!fs.statSync(path.join(kindDir, name)).isDirectory()) continue;
      const zip = new JSZip();
      addDirectoryToZip(zip, path.join(kindDir, name), name);
      const zipBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 }
      });
      fs.writeFileSync(path.join(outputDir, kind, name + '.zip'), zipBuffer);
      console.log('zip:', kind + '/' + name + '.zip', zipBuffer.length, 'bytes');
    }
  }
})();
