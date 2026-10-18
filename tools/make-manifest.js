#!/usr/bin/env node
/**
 * Writes <folder>/manifest.json so the game can read a content folder with a single request.
 *
 * Usage: node tools/make-manifest.js <folder>      (default: assets)
 * Needs: Node.js only.
 *
 * The folder may hold loose MUGEN folders (chars/<name>/<name>.def, stages/<name>.def) and/or ZIP files, one zip per
 * character or stage (chars/<name>.zip, stages/<name>.zip). A zip under a folder called stage or stages is a stage,
 * any other zip a character.
 *
 * Manifest shape: { version: 1, chars: [{zip|def, name}], stages: [{zip|def, name}], files: [loose relative paths] }
 */
const fs = require('fs'),
  path = require('path');

const contentRoot = path.resolve(process.argv[2] || path.join(__dirname, '..', 'assets')),
  allFiles = [];

/**
 * Recursively collects file paths (relative to the content root, '/'-separated) into `allFiles`,
 * skipping dot-files and the generated manifest.json / packs.js.
 * @param {string} directory absolute directory to scan
 * @param {string} relativeDir its path relative to the content root ('' for the root)
 */
const collectFiles = (directory, relativeDir) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const relativePath = relativeDir ? relativeDir + '/' + entry.name : entry.name;
    if (entry.isDirectory()) collectFiles(path.join(directory, entry.name), relativePath);
    else if (!/^(manifest\.json|packs\.js)$/i.test(relativePath)) allFiles.push(relativePath);
  }
};
collectFiles(contentRoot, '');

const zipFiles = allFiles.filter(file => /\.zip$/i.test(file)),
  looseFiles = allFiles.filter(file => !/\.zip$/i.test(file)),
  characters = [],
  stages = [],
  /** True when the .def text defines the given key (a line `key = ...`). */
  hasKey = (text, key) => new RegExp('^\\s*' + key + '\\s*=', 'im').test(text),
  /** Value of the first `key = value` line in a .def text (quotes and ;comments stripped), or ''. */
  getValue = (text, key) => {
    const match = text.match(new RegExp('^\\s*' + key + '\\s*=\\s*"?([^"\\r\\n;]*)', 'im'));
    return match ? match[1].trim() : '';
  };

// Zips: classified by the folder they sit in.
for (const zipFile of zipFiles)
  (/(^|\/)stages?\//i.test(zipFile) ? stages : characters).push({
    zip: zipFile,
    name: path.basename(zipFile).replace(/\.zip$/i, '')
  });
// Loose .def files: classified by their content (character vs stage definition).
for (const file of looseFiles) {
  if (!/\.def$/i.test(file)) continue;
  const defText = fs.readFileSync(path.join(contentRoot, file), 'latin1');
  if (hasKey(defText, 'cmd') && hasKey(defText, 'cns') && hasKey(defText, 'sprite') && hasKey(defText, 'anim'))
    characters.push({ def: file, name: getValue(defText, 'displayname') || getValue(defText, 'name') });
  else if (
    /^\s*\[\s*bgdef\s*\]/im.test(defText) &&
    /^\s*\[\s*bg\s+/im.test(defText) &&
    hasKey(defText, 'spr') &&
    /^\s*\[\s*(camera|stageinfo|playerinfo)\s*\]/im.test(defText)
  )
    stages.push({ def: file, name: getValue(defText, 'name') });
}
fs.writeFileSync(
  path.join(contentRoot, 'manifest.json'),
  JSON.stringify({ version: 1, chars: characters, stages, files: looseFiles }, null, 1)
);
console.log(
  'manifest.json:',
  characters.length,
  'characters,',
  stages.length,
  'stages,',
  looseFiles.length,
  'loose files,',
  zipFiles.length,
  'zips in',
  contentRoot
);
