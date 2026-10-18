/* =====================================================================
   Content: the base folder that fighters and stages are loaded from.

   The folder is a URL path (relative to the page, or absolute with CORS).
   Where it comes from, first match wins:
     1. ?base=<url> in the page address
     2. the value saved from the "Content folder" box on the fighter screen
     3. window.IK_CONFIG.base (set it in index.html or config.js)
     4. "assets/"
   Characters and stages can be loose MUGEN folders or ZIP files, one zip per character or stage.
   A browser cannot list a folder by itself, so the folder is read in one of two ways:
     - manifest.json in the folder (made by `node tools/make-manifest.js <folder>`): one request
     - otherwise the folder's directory index (python -m http.server, nginx autoindex, apache)
   Only the roster (names and file references) is read here. Sprites, sounds
   and states are fetched when a fighter or stage is picked for a match.
   If the folder cannot be read at all (for example the page was opened from file://),
   the packs bundled into the page (assets/packs.js) are used instead.
   ===================================================================== */
/** Content-folder loader: finds the base folder and fills the Roster from it. */
const Content = {
  DEFAULT: 'assets/',
  base: 'assets/',
  how: '', // how the current base was read: 'manifest', 'directory index' or 'bundled'

  /**
   * Normalises a base folder URL: trims it, falls back to the default and ensures a trailing slash.
   * @param {string} [rawUrl] user supplied folder URL
   * @returns {string} URL ending in '/'
   */
  norm(rawUrl) {
    const url = (rawUrl || '').trim() || this.DEFAULT;
    return /\/$/.test(url) ? url : url + '/';
  },

  /**
   * Picks the base folder at start-up: ?base= parameter, saved value, IK_CONFIG, then the default.
   * @returns {string} normalised base URL
   */
  initialBase() {
    try {
      const fromQuery = new URLSearchParams(location.search).get('base');
      if (fromQuery) return this.norm(fromQuery);
    } catch (error) {}
    try {
      const saved = localStorage.getItem('ik.base');
      if (saved) return this.norm(saved);
    } catch (error) {}
    return this.norm(window.IK_CONFIG && window.IK_CONFIG.base);
  },

  /**
   * Fetches and parses a JSON file without using the HTTP cache.
   * @param {string} url address of the JSON file
   * @returns {Promise<object>} parsed JSON
   */
  async fetchJson(url) {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(response.status + ' ' + url);
    return response.json();
  },

  /**
   * Reads the roster of one base folder into the Roster, from manifest.json or the directory index.
   * @param {string} base normalised base folder URL
   * @returns {Promise<{nc: number, ns: number, how: string}>} counts of added fighters/stages and the read method
   */
  async read(base) {
    let paths = null,
      listed = null, // explicit chars/stages lists from the manifest, if any
      how = '';
    try {
      const manifest = await this.fetchJson(base + 'manifest.json');
      how = 'manifest';
      paths = (manifest.files || []).map(String);
      if (manifest.chars || manifest.stages)
        listed = {
          chars: (manifest.chars || []).map(item => (typeof item === 'string' ? { def: item } : item)),
          stages: (manifest.stages || []).map(item => (typeof item === 'string' ? { def: item } : item))
        };
    } catch (error) {
      paths = null;
    }
    if (!paths) {
      paths = await MG.crawl(base, 4);
      how = 'directory index';
    }
    if (!paths.length && !(listed && (listed.chars.length || listed.stages.length)))
      throw new Error(
        'Nothing could be listed at ' +
          base +
          '. Add a manifest.json (node tools/make-manifest.js) or enable directory listing.'
      );
    /** Absolute URL of a path inside the content folder; `isZip` tells whether a path is a ZIP. */
    const toUrl = path => base + path.split('/').map(encodeURIComponent).join('/'),
      isZip = path => /\.zip$/i.test(path);
    const vfs = await MG.vfsFromUrls(
      base,
      paths.filter(path => !isZip(path))
    );
    let charCount = 0,
      stageCount = 0;
    /** True when a ZIP sits under a folder called stage or stages. */
    const isStageZip = path => /(^|\/)stages?\//i.test(path),
      makeZipRecord = (kind, path, name) => ({
        zip: toUrl(path),
        kind,
        name:
          name ||
          path
            .split('/')
            .pop()
            .replace(/\.zip$/i, '')
      });
    if (listed) {
      /** Builds a roster record for one manifest entry (zip reference or def file inside the vfs). */
      const makeRecord = (kind, item) => {
        if (item.zip) return makeZipRecord(kind, String(item.zip), item.name);
        const file = vfs.files.get(String(item.def).replace(/\\/g, '/').toLowerCase());
        return file
          ? { vfs, lc: String(item.def).toLowerCase(), f: file, def: null, text: null, name: item.name }
          : null;
      };
      for (const item of listed.chars) {
        const record = makeRecord('char', item);
        if (record && Roster.addChar(record, 'base')) charCount++;
      }
      for (const item of listed.stages) {
        const record = makeRecord('stage', item);
        if (record && Roster.addStage(record, 'base')) stageCount++;
      }
    } else {
      const found = await MG.scan(vfs);
      for (const record of found.chars) if (Roster.addChar(record, 'base')) charCount++;
      for (const record of found.stages) if (Roster.addStage(record, 'base')) stageCount++;
      // zip files: those under a stage(s)/ folder are stages, all others are fighters
      for (const path of paths.filter(isZip)) {
        if (isStageZip(path)) {
          if (Roster.addStage(makeZipRecord('stage', path), 'base')) stageCount++;
        } else if (Roster.addChar(makeZipRecord('char', path), 'base')) charCount++;
      }
    }
    return { nc: charCount, ns: stageCount, how };
  },

  /**
   * Loads the packs bundled into the page (assets/packs.js); the fallback when no folder can be read.
   * @returns {Promise<{nc: number, ns: number, how: string}>} counts of added fighters/stages
   */
  async loadBundled() {
    let charCount = 0,
      stageCount = 0;
    for (const pack of window.IK_PACKS || []) {
      const entries = Object.keys(pack.files).map(path => ({
        path,
        read: async () => b64ToBuf(pack.files[path])
      }));
      const imported = await MGUI.importVfs(await MG.makeVfs(entries), true, 'base');
      charCount += imported.nc;
      stageCount += imported.ns;
    }
    return { nc: charCount, ns: stageCount, how: 'bundled' };
  },

  /**
   * Replaces the 'base' part of the roster with the content of a folder (or the bundled packs on failure).
   * @param {string} base normalised base folder URL
   * @returns {Promise<{nc: number, ns: number, how: string, note?: string}>} load result
   */
  async load(base) {
    this.base = base;
    Roster.clear('base');
    Sel.stageIdx = -1;
    let result;
    try {
      if (location.protocol === 'file:')
        throw new Error('a page opened from a file cannot read a folder; run node tools/serve.js');
      result = await this.read(base);
    } catch (error) {
      console.warn('base folder failed:', error.message);
      if (window.IK_PACKS && window.IK_PACKS.length) {
        result = await this.loadBundled();
        result.note = 'Could not read ' + base + ' (' + error.message + '). Using the content bundled in the page.';
      } else throw error;
    }
    this.how = result.how;
    if (typeof Sel !== 'undefined' && Sel.built) Sel.build();
    return result;
  },

  /**
   * Builds the status sentence shown after a load.
   * @param {{nc: number, ns: number, how: string, note?: string}} result value returned by load()
   * @returns {string} human readable summary
   */
  describe(result) {
    return (
      result.note ||
      'Loaded ' +
        result.nc +
        ' fighter' +
        (result.nc === 1 ? '' : 's') +
        ' and ' +
        result.ns +
        ' stage' +
        (result.ns === 1 ? '' : 's') +
        ' from ' +
        this.base +
        ' (' +
        result.how +
        ').'
    );
  },

  /** Loads the initial base folder at start-up and reports the outcome in the status line. */
  async boot() {
    try {
      const result = await this.load(this.initialBase());
      MGUI.status(this.describe(result), !!result.note);
    } catch (error) {
      MGUI.status(error.message, true);
    }
    const urlInput = $('#base-url');
    if (urlInput) urlInput.value = this.base;
  },

  /**
   * Handles the "Content folder" box: loads the typed folder and remembers it when it worked.
   * @param {string} url folder typed by the user
   */
  async setBase(url) {
    const base = this.norm(url);
    MGUI.status('Reading ' + base + '…');
    try {
      const result = await this.load(base);
      MGUI.status(this.describe(result), !!result.note);
      try {
        localStorage.setItem('ik.base', base);
      } catch (error) {}
    } catch (error) {
      MGUI.status(error.message, true);
    }
    const urlInput = $('#base-url');
    if (urlInput) urlInput.value = this.base;
  }
};
