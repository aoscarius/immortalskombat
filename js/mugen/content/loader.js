/* =====================================================================
   Loader: turns a virtual file system (see vfs.js) into characters.

   Two phases
   - classify() / scan() read only the .def files (cheap). They produce light
     "found" records `{ vfs, lc, f, def, text }` used to build the roster:
       lc  : lower-cased path of the .def inside the VFS
       f   : the VFS file record of the .def ({ path, read })
       def : the parsed .def (see MG.parseDef)
       text: raw .def text (stages only, so the stage loader can re-parse it)
   - loadChar() reads everything a fighter needs (sprites, sounds, animations,
     commands, states, palettes) and is called when a match starts. It returns
     a "package" (pkg) consumed by the engine.

   Net id scheme
   - Both peers of an online match must agree on which character/stage is meant
     without sharing absolute paths. MG.netKey() hashes "kind:parentFolder/file.def"
     (kind 'c' = character, 's' = stage) into a short base-36 string: the netId.
   - Each pkg records every VFS file it touched (`usedFiles`) so the files can be
     sent to a peer that lacks the asset (see MG.exportFiles / MG.vfsFromEntries).

   Health check
   - MG.healthCheck() reports missing standard animations/states and controllers
     the engine does not implement; shown in the debug overlay and bug report.
   ===================================================================== */

/**
 * Decides what a .def file describes.
 * @param {string} text Decoded .def text.
 * @returns {{kind: 'char'|'stage', def: object}|null} The kind plus the parsed def (for reuse), or null if neither.
 */
MG.classify = function (text) {
  const def = MG.parseDef(text),
    fileRefs = def.files,
    sections = def.sections;
  // A character names its command, constants, sprite and animation files.
  if (fileRefs['cmd'] && fileRefs['cns'] && fileRefs['sprite'] && fileRefs['anim']) return { kind: 'char', def };
  // A stage has a [BGdef] with a sprite file, at least one [BG ...] element and camera/info sections.
  if (
    /^\s*\[\s*bgdef\s*\]/im.test(text) &&
    /^\s*\[\s*bg\s+/im.test(text) &&
    (sections['camera'] || sections['stageinfo'] || sections['playerinfo']) &&
    sections['bgdef'] &&
    sections['bgdef'].map['spr']
  )
    return { kind: 'stage', def };
  return null;
};

/**
 * Finds characters and stages in a VFS without loading them. Only .def files are read.
 * @param {object} vfs The virtual file system.
 * @returns {Promise<{chars: object[], stages: object[]}>} Light "found" records (see file header).
 */
MG.scan = async function (vfs) {
  const defEntries = [...vfs.files].filter(([lowerPath]) => lowerPath.endsWith('.def')),
    chars = [],
    stages = [];
  await MG.pool(defEntries, 4, async ([lc, f]) => {
    let text, classified;
    try {
      text = MG.decodeText(await f.read());
      classified = MG.classify(text);
    } catch (error) {
      return;
    }
    if (!classified) return;
    (classified.kind === 'char' ? chars : stages).push({
      vfs,
      lc,
      f,
      def: classified.def,
      text: classified.kind === 'stage' ? text : null
    });
  });
  return { chars, stages };
};

/**
 * Identity shared between peers: a hash of the .def's parent folder and file name.
 * @param {string} kind 'c' for a character, 's' for a stage.
 * @param {string} path Path of the .def inside its VFS.
 * @returns {string} Short base-36 id.
 */
MG.netKey = (kind, path) => {
  const parts = normPath(path).toLowerCase().split('/');
  return hashStr(kind + ':' + parts.slice(-2).join('/')).toString(36);
};

/**
 * One character (or stage) stored in a ZIP: opens it and finds its .def.
 * When the ZIP holds several, the one named like the ZIP wins.
 * @param {'char'|'stage'} kind What to look for.
 * @param {string} zipUrl URL of the ZIP.
 * @returns {Promise<object>} A "found" record.
 */
MG.zipFound = async function (kind, zipUrl) {
  const vfs = await MG.vfsFromZipBuffer(await MG.fetchBuf(zipUrl)),
    found = await MG.scan(vfs),
    candidates = kind === 'stage' ? found.stages : found.chars;
  if (!candidates.length) throw new Error('No ' + kind + ' found inside ' + zipUrl);
  const zipName = decodeURIComponent(zipUrl)
    .split('/')
    .pop()
    .replace(/\.zip$/i, '')
    .toLowerCase();
  return (
    candidates.find(
      candidate =>
        candidate.f.path
          .split('/')
          .pop()
          .replace(/\.def$/i, '')
          .toLowerCase() === zipName
    ) || candidates[0]
  );
};

/**
 * Lists the characters in a VFS.
 * @param {object} vfs The virtual file system.
 * @returns {Promise<object[]>} "found" records of characters.
 */
MG.findChars = async function (vfs) {
  return (await MG.scan(vfs)).chars;
};

/**
 * Lists the stages in a VFS.
 * @param {object} vfs The virtual file system.
 * @returns {Promise<object[]>} "found" records of stages.
 */
MG.findStages = async function (vfs) {
  return (await MG.scan(vfs)).stages;
};

/**
 * Loads everything a fighter needs (sprites, animations, commands, states, sounds, palettes).
 * @param {object} found A "found" record from scan().
 * @param {function(string): void} [onProgress] Receives human-readable progress messages.
 * @returns {Promise<object>} The character package (pkg).
 */
MG.loadChar = async function (found, onProgress) {
  const { vfs, f } = found;
  let def = found.def;
  if (!def) def = MG.parseDef(MG.decodeText(await f.read()));
  const dir = f.path.split('/').slice(0, -1).join('/').toLowerCase(),
    fileRefs = def.files,
    usedFiles = [f];
  // Resolves a file and remembers it so it can be exported to a peer later.
  const resolveTracked = (searchVfs, searchDir, name) => {
    const file = resolveIn(searchVfs, searchDir, name);
    if (file && usedFiles.indexOf(file) < 0) usedFiles.push(file);
    return file;
  };
  // Reads the file that the .def lists under `key`; null if missing.
  const readRef = async key => {
    const file = resolveTracked(vfs, dir, unquote(fileRefs[key]));
    return file ? file.read() : null;
  };
  const pkg = {
    name: def.name,
    author: def.author,
    local: def.localcoord,
    palDefaults: def.palDefaults,
    defPath: f.path,
    acts: {},
    vfsDir: dir
  };
  const reportProgress = message => onProgress && onProgress(def.name + ': ' + message);
  reportProgress('sprites');
  const spriteBytes = await readRef('sprite');
  if (!spriteBytes) throw new Error('Sprite file ' + fileRefs['sprite'] + ' not found');
  pkg.sff = await MG.readSff(spriteBytes);
  reportProgress('animations');
  const animBytes = await readRef('anim');
  if (!animBytes) throw new Error('Animation file ' + fileRefs['anim'] + ' not found');
  pkg.air = MG.parseAir(MG.decodeText(animBytes));
  reportProgress('states');
  const cmdBytes = await readRef('cmd');
  if (!cmdBytes) throw new Error('Command file not found');
  const cmdText = MG.decodeText(cmdBytes);
  pkg.commands = MG.parseCommands(cmdText);
  // The .cmd file may also contain states; they are merged last so they override .cns ones.
  const cmdStates = MG.parseCns(cmdText);
  pkg.states = new Map();
  pkg.consts = {};
  const mergeCns = parsed => {
    for (const [stateNo, state] of parsed.states) pkg.states.set(stateNo, state);
    for (const constName in parsed.consts) pkg.consts[constName] = parsed.consts[constName];
  };
  const cnsBytes = await readRef('cns');
  if (!cnsBytes) throw new Error('Constants file not found');
  mergeCns(MG.parseCns(MG.decodeText(cnsBytes)));
  mergeCns(cmdStates);
  // Additional state files: st, st1, st2, ...
  for (const key of Object.keys(fileRefs))
    if (/^st\d*$/.test(key)) {
      const file = resolveTracked(vfs, dir, unquote(fileRefs[key]));
      if (file && unquote(fileRefs[key]).toLowerCase() !== unquote(fileRefs['cns']).toLowerCase())
        mergeCns(MG.parseCns(MG.decodeText(await file.read())));
    }
  /* common states: the character's own stcommon file if it ships one, otherwise the built-in set */
  pkg.common = null;
  const commonName = unquote(fileRefs['stcommon'] || '');
  if (commonName) {
    const file = resolveTracked(vfs, dir, commonName);
    if (file) {
      try {
        pkg.common = MG.parseCns(MG.decodeText(await file.read())).states;
      } catch (error) {
        // An unreadable stcommon is ignored: the built-in common states are used instead.
      }
    }
  }
  const soundBytes = await readRef('sound');
  pkg.snd = soundBytes ? MG.readSnd(soundBytes) : new Map();
  // Palette files pal1..pal12 (.act); a broken one is skipped.
  for (let slot = 1; slot <= 12; slot++) {
    const key = 'pal' + slot;
    if (fileRefs[key]) {
      const file = resolveTracked(vfs, dir, unquote(fileRefs[key]));
      if (file) {
        try {
          pkg.acts[slot] = MG.readAct(await file.read());
        } catch (error) {
          // Skip an unreadable palette.
        }
      }
    }
  }
  pkg.health = MG.healthCheck(pkg);
  pkg.id = 'mg:' + f.path.toLowerCase();
  pkg.localScale = null;
  pkg.usedFiles = usedFiles;
  pkg.netId = MG.netKey('c', f.path);
  // Cheap content signature used to tell characters apart.
  pkg.sig = hashStr(
    pkg.id + ':' + pkg.sff.list.length + ':' + pkg.air.size + ':' + pkg.states.size + ':' + pkg.commands.length
  );
  return pkg;
};

/**
 * Collects the files of a loaded asset (character or stage) for sending to a peer.
 * @param {{usedFiles: object[]}} asset A loaded character package or stage.
 * @returns {Promise<{path: string, data: Uint8Array}[]>} Raw file contents.
 */
MG.exportFiles = async function (asset) {
  const exported = [];
  for (const file of asset.usedFiles) exported.push({ path: file.path, data: new Uint8Array(await file.read()) });
  return exported;
};

/**
 * Builds a VFS from in-memory entries (the inverse of exportFiles, used for received assets).
 * @param {{path: string, data: Uint8Array}[]} entries Files with their bytes.
 * @returns {Promise<object>} The new VFS.
 */
MG.vfsFromEntries = function (entries) {
  return MG.makeVfs(
    entries.map(entry => ({
      path: entry.path,
      read: async () => {
        const bytes = entry.data;
        // The view may sit inside a larger buffer: copy out exactly its range.
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
    }))
  );
};

/**
 * A quick sanity check of a loaded character: which standard animations it lacks and which
 * controllers it uses that the engine does not implement. Shown in the debug overlay (F2)
 * and included in the bug report (F3).
 * @param {object} pkg A loaded character package.
 * @returns {object} Counts plus `missingAnims`, `unsupportedControllers` and `ownCommonStates`.
 */
MG.healthCheck = function (pkg) {
  // Standard action numbers: stand, turn, walk, crouch, jump, guard, hit and fall animations.
  const requiredAnims = [0, 10, 11, 12, 20, 21, 40, 41, 5000, 5010, 5020, 5030, 5040, 5050, 5100, 5110, 5120, 5150];
  const missingAnims = requiredAnims.filter(actionNo => !pkg.air.has(actionNo));
  const unsupported = new Set();
  for (const state of pkg.states.values())
    for (const controller of state.ctrls)
      if (controller.type && !MCTL[controller.type] && !MQUIET.has(controller.type)) unsupported.add(controller.type);
  return {
    actions: pkg.air.size,
    states: pkg.states.size,
    commands: pkg.commands.length,
    sprites: pkg.sff.list.length,
    sffVersion: pkg.sff.ver,
    missingAnims,
    unsupportedControllers: [...unsupported].sort(),
    ownCommonStates: !!pkg.common
  };
};
