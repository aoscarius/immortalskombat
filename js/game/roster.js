/* =====================================================================
   Roster: every fighter and stage that is known, and which of them are
   loaded right now.

   There are no built-in fighters or stages. Content comes from the base
   folder (see content.js), or from folders / ZIPs the player adds.

   A roster entry is a light "stub" (name, def file, network id). Its heavy
   data (sprites, sounds, states) is loaded when the entry is picked for a
   match and released again when the match is over, so memory stays near
   what two fighters and one stage need, however many are installed.
   ===================================================================== */

/** Every known fighter stub (see Roster.charStub). */
const CHARS = [];
/** Every known stage record (see Roster.stageStub). */
const STAGES = [];
/** Record of the built-in emergency stage used when no stage can be loaded. */
const FALLBACK_REC = {
  id: 'fallback',
  netId: 'fallback',
  name: FALLBACK_STAGE.name,
  kind: 'fallback',
  st: FALLBACK_STAGE,
  get: () => FALLBACK_STAGE
};

/**
 * Converts a hue angle to an "#rrggbb" colour (fixed saturation and lightness).
 * @param {number} hueDegrees hue in degrees
 * @returns {string} hex colour
 */
function hueHex(hueDegrees) {
  /** One colour channel (two hex digits) of the HSL conversion. */
  const channel = offset => {
    const k = (offset + hueDegrees / 30) % 12,
      amplitude = 0.8 * 0.38;
    return Math.round(255 * (0.62 - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, '0');
  };
  return '#' + channel(0) + channel(8) + channel(4);
}

/** File name without folders and without a .def / .zip extension. */
const baseName = path => (path.split('/').pop() || path).replace(/\.(def|zip)$/i, '');

/** Turns "some_name-x" into "Some Name X". */
const prettify = name => name.replace(/[_-]+/g, ' ').replace(/\b[a-z]/g, letter => letter.toUpperCase());

/** Unique lower-case key of a found record: a roster record is either loose ({vfs, f, def?}) or a ZIP not opened yet ({zip: url, kind}). */
const foundKey = found => (found.zip ? 'zip:' + found.zip : found.f.path).toLowerCase();

/** Fields of a loaded fighter package that are released when the match is over. */
const HEAVY = ['sff', 'air', 'commands', 'states', 'consts', 'snd', 'acts', 'common', 'usedFiles'];

/** Roster management: creates stubs, loads and releases their heavy data. */
const Roster = {
  /* ---- stubs ---- */
  /**
   * Builds the light roster entry of a fighter.
   * @param {object} found scan record of the fighter
   * @param {string} src origin of the record ('base' or 'local')
   * @returns {object} fighter stub
   */
  charStub(found, src) {
    const key = foundKey(found),
      id = 'mg:' + key,
      hue = hashStr(id) % 360,
      def = found.def,
      isZip = !!found.zip;
    const name =
      (def && def.name) ||
      (found.name && (isZip ? prettify(found.name) : found.name)) ||
      prettify(baseName(isZip ? found.zip : found.f.path));
    return {
      id,
      name,
      title: def && def.author ? 'by ' + def.author : '',
      src,
      mugen: {
        loaded: false,
        id,
        name,
        author: def ? def.author : '',
        defPath: isZip ? decodeURIComponent(found.zip) : found.f.path,
        netId: MG.netKey('c', isZip ? 'zip/' + baseName(decodeURIComponent(found.zip)) : found.f.path),
        found
      },
      palSlot: 1,
      c: { accent: hueHex(hue) },
      bg: [hueHex(hue) + '55', '#0a0708']
    };
  },
  /**
   * Builds the light roster entry of a stage.
   * @param {object} found scan record of the stage
   * @param {string} src origin of the record ('base' or 'local')
   * @returns {object} stage record
   */
  stageStub(found, src) {
    const key = foundKey(found),
      def = found.def,
      isZip = !!found.zip;
    return {
      id: 'st:' + key,
      name:
        (def && def.name) ||
        (found.name && (isZip ? prettify(found.name) : found.name)) ||
        prettify(baseName(isZip ? found.zip : found.f.path)),
      kind: 'mugen',
      src,
      netId: MG.netKey('s', isZip ? 'zip/' + baseName(decodeURIComponent(found.zip)) : found.f.path),
      found,
      st: null,
      loading: null,
      /** @returns {object|null} the loaded stage, or null while it is not loaded */
      get() {
        return this.st;
      }
    };
  },
  /**
   * A ZIP record becomes a loose one once opened.
   * @param {object} found scan record
   * @param {boolean} keep false opens it for a single look (thumbnail) without remembering it
   * @returns {Promise<object>} the opened record
   */
  async resolve(found, keep) {
    if (!found.zip || found.f) return found;
    const opened = await MG.zipFound(found.kind, found.zip);
    if (!keep) return opened;
    Object.assign(found, { vfs: opened.vfs, lc: opened.lc, f: opened.f, def: opened.def, text: opened.text });
    return found;
  },
  /**
   * Adds a fighter to CHARS unless it is already there.
   * @param {object} found scan record
   * @param {string} src origin ('base' or 'local')
   * @returns {object|null} the new stub, or null for a duplicate
   */
  addChar(found, src) {
    const id = 'mg:' + foundKey(found);
    if (CHARS.some(existing => existing.id === id)) return null;
    const ch = this.charStub(found, src);
    CHARS.push(ch);
    return ch;
  },
  /**
   * Adds a stage to STAGES unless it is already there.
   * @param {object} found scan record
   * @param {string} src origin ('base' or 'local')
   * @returns {object|null} the new record, or null for a duplicate
   */
  addStage(found, src) {
    const id = 'st:' + foundKey(found);
    if (STAGES.some(existing => existing.id === id)) return null;
    const stageRecord = this.stageStub(found, src);
    STAGES.push(stageRecord);
    return stageRecord;
  },
  /**
   * Copy of a fighter entry that uses another palette slot (for mirror matches).
   * @param {object} ch fighter stub
   * @param {number} paletteSlot palette number
   * @returns {object} the copy
   */
  mirrorOf(ch, paletteSlot) {
    return Object.assign({}, ch, { id: ch.id + '#' + paletteSlot, palSlot: paletteSlot });
  },
  /**
   * Removes everything that came from one source ('base' or 'local').
   * @param {string} src source name
   */
  clear(src) {
    for (let index = CHARS.length - 1; index >= 0; index--)
      if (CHARS[index].src === src) {
        this.releaseChar(CHARS[index]);
        CHARS.splice(index, 1);
      }
    for (let index = STAGES.length - 1; index >= 0; index--)
      if (STAGES[index].src === src) {
        this.releaseStage(STAGES[index]);
        STAGES.splice(index, 1);
      }
  },
  /* ---- loading ---- */
  /**
   * Loads the heavy data (sprites, sounds, states) of a fighter; concurrent calls share one load.
   * @param {object} ch fighter stub
   * @returns {Promise<object>} the fighter's `mugen` package object
   */
  async loadChar(ch) {
    const pkgSlot = ch.mugen;
    if (pkgSlot.loaded) return pkgSlot;
    if (!pkgSlot.loading)
      pkgSlot.loading = this.resolve(pkgSlot.found, true)
        .then(found => MG.loadChar(found))
        .then(pkg => {
          const identity = { id: pkgSlot.id, netId: pkgSlot.netId, defPath: pkgSlot.defPath };
          Object.assign(pkgSlot, pkg, identity, { loaded: true });
          ch.name = pkgSlot.name = pkg.name;
          ch.title = pkg.author ? 'by ' + pkg.author : '';
          return pkgSlot;
        })
        .finally(() => {
          pkgSlot.loading = null;
        });
    return pkgSlot.loading;
  },
  /**
   * Loads the data of a stage; concurrent calls share one load.
   * @param {object} rec stage record
   * @returns {Promise<object>} the loaded stage
   */
  async loadStage(rec) {
    if (rec.kind !== 'mugen' || rec.st) return rec.st;
    if (!rec.loading)
      rec.loading = this.resolve(rec.found, true)
        .then(found => MG.loadStage(found))
        .then(stage => {
          stage.netId = rec.netId;
          rec.st = stage;
          return stage;
        })
        .finally(() => {
          rec.loading = null;
        });
    return rec.loading;
  },
  /**
   * Frees the heavy data of a fighter (sprites, sound buffers, states).
   * @param {object} ch fighter stub
   */
  releaseChar(ch) {
    const pkg = ch.mugen;
    if (!pkg || !pkg.loaded) return;
    MG.freeSff(pkg.sff);
    if (pkg.snd)
      for (const sound of pkg.snd.values()) {
        sound.buf = null;
        sound.data = null;
        sound.pending = null;
      }
    for (const field of HEAVY) delete pkg[field];
    pkg.loaded = false;
    this.forget(pkg.found);
  },
  /**
   * Frees the loaded data of a stage.
   * @param {object} rec stage record
   */
  releaseStage(rec) {
    if (rec.kind !== 'mugen' || !rec.st) return;
    if (rec.st.pkg) MG.freeSff(rec.st.pkg.sff);
    rec.st = null;
    this.forget(rec.found);
  },
  /**
   * An opened ZIP is dropped with the match, so its bytes do not stay in memory.
   * @param {object} found scan record
   */
  forget(found) {
    if (found.zip) {
      found.vfs = found.f = found.def = found.text = found.lc = null;
    }
  },
  /**
   * Makes sure what a match needs is in memory, and drops what it does not.
   * @param {object[]} chars fighters of the match
   * @param {object} [stageRec] stage record of the match
   * @param {Function} [onStatus] called with progress messages
   */
  async prepare(chars, stageRec, onStatus) {
    const report = onStatus || (() => {});
    for (const ch of chars)
      if (!ch.mugen.loaded) {
        report('Loading ' + ch.name + '…');
        await this.loadChar(ch);
      }
    if (stageRec && stageRec.kind === 'mugen' && !stageRec.st) {
      report('Loading stage ' + stageRec.name + '…');
      await this.loadStage(stageRec);
    }
    this.trim(chars, stageRec);
  },
  /**
   * Releases every fighter and stage except the ones to keep.
   * @param {object[]} [keepChars] fighters to keep loaded
   * @param {object} [keepStage] stage to keep loaded
   */
  trim(keepChars, keepStage) {
    const keepPackages = new Set((keepChars || []).map(ch => ch.mugen));
    for (const ch of CHARS) if (!keepPackages.has(ch.mugen)) this.releaseChar(ch);
    for (const stageRecord of STAGES) if (stageRecord !== keepStage) this.releaseStage(stageRecord);
  }
};

/* ------------------------------ thumbnails ------------------------------ */
/**
 * Card pictures are made one at a time: the sprite file is read, one portrait
 * sprite is drawn, and everything else is dropped.
 */
const Thumbs = {
  W: 128,
  H: 130,
  cache: new Map(),
  q: [],
  busy: false,
  /**
   * Asks for a fighter's thumbnail; `done` gets a canvas (at once if cached).
   * @param {object} ch fighter stub
   * @param {Function} done callback receiving the thumbnail canvas
   */
  request(ch, done) {
    const cached = this.cache.get(ch.id);
    if (cached) return done(cached);
    this.q.push({ ch, done });
    this.pump();
  },
  /** Works through the request queue one thumbnail at a time. */
  async pump() {
    if (this.busy) return;
    this.busy = true;
    while (this.q.length) {
      const { ch, done } = this.q.shift();
      let thumbCanvas = this.cache.get(ch.id);
      if (!thumbCanvas) {
        try {
          thumbCanvas = await this.make(ch);
        } catch (error) {
          thumbCanvas = this.letter(ch);
        }
        this.cache.set(ch.id, thumbCanvas);
      }
      done(thumbCanvas);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    this.busy = false;
  },
  /**
   * Fallback thumbnail: the first letter of the name on the card background.
   * @param {object} ch fighter stub
   * @returns {HTMLCanvasElement}
   */
  letter(ch) {
    const canvas = document.createElement('canvas');
    canvas.width = this.W;
    canvas.height = this.H;
    const context = canvas.getContext('2d');
    this.back(context, ch);
    context.fillStyle = ch.c.accent;
    context.font = '700 ' + this.H * 0.3 + 'px sans-serif';
    context.textAlign = 'center';
    context.fillText((ch.name[0] || '?').toUpperCase(), this.W / 2, this.H * 0.62);
    return canvas;
  },
  /**
   * Paints the gradient card background.
   * @param {CanvasRenderingContext2D} context target context
   * @param {object} ch fighter stub (its `bg` holds the two colours)
   */
  back(context, ch) {
    const gradient = context.createLinearGradient(0, 0, 0, this.H);
    gradient.addColorStop(0, ch.bg[0]);
    gradient.addColorStop(1, ch.bg[1]);
    context.fillStyle = gradient;
    context.fillRect(0, 0, this.W, this.H);
  },
  /**
   * Opens a ZIP record for a single look without remembering it.
   * @param {object} found scan record
   * @returns {object|Promise<object>} the readable record
   */
  peek(found) {
    return found.zip && !found.f ? Roster.resolve(found, false) : found;
  },
  /**
   * Draws the thumbnail of a fighter (from the loaded package, or by reading only a portrait sprite).
   * @param {object} ch fighter stub
   * @returns {Promise<HTMLCanvasElement>}
   */
  async make(ch) {
    const pkg = ch.mugen;
    if (pkg.loaded) {
      const loadedCanvas = document.createElement('canvas');
      loadedCanvas.width = this.W;
      loadedCanvas.height = this.H;
      Mugen.portrait(loadedCanvas, ch, false);
      return loadedCanvas;
    }
    const found = await this.peek(pkg.found);
    let def = found.def;
    if (!def) def = found.def = MG.parseDef(MG.decodeText(await found.f.read()));
    const spriteFile = resolveIn(
      found.vfs,
      found.f.path.split('/').slice(0, -1).join('/').toLowerCase(),
      unquote(def.files['sprite'])
    );
    if (!spriteFile) return this.letter(ch);
    const sff = await MG.readSff(await spriteFile.read(), new Set(['9000,0', '9000,1', '0,0']));
    try {
      const sprite = ['9000,1', '9000,0', '0,0']
        .map(key => sff.sprites.get(key))
        .find(
          candidate =>
            candidate &&
            (candidate.w > 4 || candidate.raw || candidate.raw1 || candidate.idx || candidate.rgba) &&
            candidate.w > 4
        );
      const canvas = document.createElement('canvas');
      canvas.width = this.W;
      canvas.height = this.H;
      const context = canvas.getContext('2d');
      this.back(context, ch);
      const spriteCanvas = sprite && MG.spriteCanvas({ sff, acts: {} }, sprite, 1);
      if (!spriteCanvas) return this.letter(ch);
      context.imageSmoothingEnabled = false;
      const scale = Math.min((this.W * 0.9) / spriteCanvas.width, (this.H * 0.92) / spriteCanvas.height),
        drawWidth = spriteCanvas.width * scale,
        drawHeight = spriteCanvas.height * scale;
      context.drawImage(spriteCanvas, (this.W - drawWidth) / 2, this.H - drawHeight - 4, drawWidth, drawHeight);
      return canvas;
    } finally {
      MG.freeSff(sff);
    }
  }
};

/* ------------------------------ importing from the player ------------------------------ */
/** Import of fighters and stages that the player picks or drops into the page. */
const MGUI = {
  /**
   * Shows a status line on the title screen.
   * @param {string} message text to show
   * @param {boolean} [isError] style it as an error
   */
  status(message, isError) {
    const el = $('#mg-status');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('err', !!isError);
  },
  /**
   * Adds every character and stage found in a virtual file system (reads only the .def files).
   * @param {object} vfs virtual file system
   * @param {boolean} [quiet] do not write a status line
   * @param {string} [src] origin tag (default 'local')
   * @returns {Promise<{nc:number, ns:number, chars:object[], stages:object[]}>} what was added
   */
  async importVfs(vfs, quiet, src) {
    const { chars, stages } = await MG.scan(vfs);
    if (!chars.length && !stages.length)
      throw new Error(
        'No MUGEN character or stage found in those files. A character needs a .def that names cmd, cns, sprite and anim files; a stage needs a .def with a [BGdef] section.'
      );
    let charCount = 0,
      stageCount = 0;
    const addedChars = [],
      addedStages = [];
    for (const found of chars) {
      const stub = Roster.addChar(found, src || 'local');
      if (stub) {
        charCount++;
        addedChars.push(stub);
      }
    }
    for (const found of stages) {
      const stageRecord = Roster.addStage(found, src || 'local');
      if (stageRecord) {
        stageCount++;
        addedStages.push(stageRecord);
      }
    }
    if (typeof Sel !== 'undefined') Sel.build();
    if (!quiet) {
      const parts = [];
      if (charCount) parts.push(charCount + ' character' + (charCount > 1 ? 's' : ''));
      if (stageCount) parts.push(stageCount + ' stage' + (stageCount > 1 ? 's' : ''));
      this.status(
        parts.length ? 'Added ' + parts.join(' and ') + '. They load when you pick them.' : 'Nothing new to add.'
      );
    }
    return { nc: charCount, ns: stageCount, chars: addedChars, stages: addedStages };
  },
  /**
   * Imports files chosen with a file input (ZIPs and loose files).
   * @param {FileList|File[]} files chosen files
   */
  async fromFiles(files) {
    try {
      files = Array.from(files);
      if (!files.length) return;
      let vfs = null;
      /** Merges a virtual file system into the one being built. */
      const addToVfs = part => {
        vfs = vfs ? MG.vfsMerge(vfs, part) : part;
      };
      const zipFiles = files.filter(file => /\.zip$/i.test(file.name)),
        looseFiles = files.filter(file => !/\.zip$/i.test(file.name));
      this.status('Reading files…');
      for (const zipFile of zipFiles) addToVfs(await MG.vfsFromZip(zipFile));
      if (looseFiles.length) addToVfs(await MG.vfsFromFileList(looseFiles));
      await this.importVfs(vfs);
    } catch (error) {
      console.error(error);
      this.status(error.message || String(error), true);
    }
  },
  /**
   * Imports what was dropped on the page (files and whole folders).
   * @param {DataTransfer} dataTransfer the drop's data
   */
  async fromDrop(dataTransfer) {
    try {
      const files = [];
      /** Collects the files of a dropped entry; folders are read recursively. */
      const walk = async entry => {
        if (entry.isFile)
          await new Promise(resolve =>
            entry.file(file => {
              Object.defineProperty(file, 'webkitRelativePath', { value: entry.fullPath.replace(/^\//, '') });
              files.push(file);
              resolve();
            }, resolve)
          );
        else if (entry.isDirectory) {
          const reader = entry.createReader();
          for (;;) {
            const children = await new Promise(resolve => reader.readEntries(resolve, () => resolve([])));
            if (!children.length) break;
            for (const child of children) await walk(child);
          }
        }
      };
      const entries = Array.from(dataTransfer.items || [])
        .map(item => item.webkitGetAsEntry && item.webkitGetAsEntry())
        .filter(Boolean);
      if (entries.length) for (const entry of entries) await walk(entry);
      else files.push(...Array.from(dataTransfer.files));
      await this.fromFiles(files);
    } catch (error) {
      console.error(error);
      this.status(error.message || String(error), true);
    }
  }
};
