/* =====================================================================
   Virtual file system (VFS)

   Purpose: give the rest of the engine one uniform, case-insensitive view
   of game content, no matter where it came from: a dropped folder, a ZIP
   archive, a list of URLs on a web server, or in-memory entries received
   from a network peer.

   Key concepts
   - A VFS is `{ files: Map, byBase: Map }`.
       files  : lower-cased full path -> { path (original case), read() }
       byBase : lower-cased file name -> lower-cased full path (first one wins),
                used as a fallback when a .def refers to a file by bare name.
     read() always returns a Promise<ArrayBuffer>, so callers never need to
     know whether the bytes live in memory, in a ZIP or on a server.
   - Paths are normalised to forward slashes without a leading "./" or "/".
   - Network downloads go through a bounded fetch queue (MG.fetchQ) so the
     browser never opens dozens of simultaneous requests.
   - MG.crawl() discovers the files of a content folder that has no manifest
     by reading a plain web-server directory index.
   ===================================================================== */

/* ------------------------------ packages: folder or ZIP ------------------------------ */

/**
 * Normalises a path: backslashes become slashes, a leading "./" and leading slashes are dropped.
 * @param {string} path Raw path.
 * @returns {string} Normalised path (case is preserved).
 */
const normPath = path => path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');

/**
 * Builds a VFS from a list of entries.
 * @param {{path: string, read: function(): Promise<ArrayBuffer>}[]} entries Files to register.
 * @returns {Promise<{files: Map, byBase: Map}>} The new VFS.
 */
MG.makeVfs = async function (entries) {
  const vfs = { files: new Map(), byBase: new Map() };
  for (const entry of entries) {
    const path = normPath(entry.path),
      lowerPath = path.toLowerCase();
    vfs.files.set(lowerPath, { path, read: entry.read });
    const baseName = lowerPath.split('/').pop();
    // Only the first file with a given name is the fallback target.
    if (!vfs.byBase.has(baseName)) vfs.byBase.set(baseName, lowerPath);
  }
  return vfs;
};

/**
 * Builds a VFS from a browser FileList (folder picker or drag and drop).
 * @param {FileList|File[]} fileList Files chosen by the user.
 * @returns {Promise<object>} The new VFS.
 */
MG.vfsFromFileList = function (fileList) {
  return MG.makeVfs(
    Array.from(fileList).map(file => ({ path: file.webkitRelativePath || file.name, read: () => file.arrayBuffer() }))
  );
};

/**
 * Waits until the JSZip library is available. It is loaded from a CDN with `defer`,
 * so a ZIP may be needed before it has arrived.
 * @returns {Promise<void>} Resolves when JSZip exists; rejects after about 5 seconds.
 */
MG.needZip = async function () {
  for (let attempt = 0; typeof JSZip === 'undefined' && attempt < 100; attempt++)
    await new Promise(resolve => setTimeout(resolve, 50));
  if (typeof JSZip === 'undefined') throw new Error('The ZIP reader is not available (JSZip did not load).');
};

/**
 * Builds a VFS from the bytes of a ZIP archive. Directory entries and macOS metadata are skipped.
 * @param {ArrayBuffer} zipBuffer Raw ZIP bytes.
 * @returns {Promise<object>} The new VFS.
 */
MG.vfsFromZipBuffer = async function (zipBuffer) {
  await MG.needZip();
  const zip = await JSZip.loadAsync(zipBuffer),
    entries = [];
  zip.forEach((path, zipEntry) => {
    if (!zipEntry.dir && !/(^|\/)(__MACOSX|\.DS_Store)/.test(path))
      entries.push({ path, read: () => zipEntry.async('arraybuffer') });
  });
  return MG.makeVfs(entries);
};

/**
 * Builds a VFS from a ZIP File object.
 * @param {File} file The ZIP file.
 * @returns {Promise<object>} The new VFS.
 */
MG.vfsFromZip = async file => MG.vfsFromZipBuffer(await file.arrayBuffer());

/**
 * Merges VFS `source` into VFS `target` (source wins on identical paths).
 * @param {object} target VFS that is modified and returned.
 * @param {object} source VFS whose files are added.
 * @returns {object} `target`.
 */
MG.vfsMerge = function (target, source) {
  for (const [lowerPath, file] of source.files) target.files.set(lowerPath, file);
  for (const [baseName, lowerPath] of source.byBase)
    if (!target.byBase.has(baseName)) target.byBase.set(baseName, lowerPath);
  return target;
};

/**
 * Finds a file referenced by a .def: first relative to the .def's directory, then from the
 * VFS root, finally by bare file name anywhere in the VFS.
 * @param {object} vfs The VFS to search.
 * @param {string} dir Lower-cased directory of the referring .def ('' for the root).
 * @param {string} name File name or relative path as written in the .def.
 * @returns {{path: string, read: function(): Promise<ArrayBuffer>}|null} The file record or null.
 */
function resolveIn(vfs, dir, name) {
  if (!name) return null;
  const lowerName = normPath(name).toLowerCase();
  const candidates = [(dir ? dir + '/' : '') + lowerName, lowerName];
  for (const candidate of candidates) {
    const cleaned = candidate.replace(/\/\.\//g, '/');
    if (vfs.files.has(cleaned)) return vfs.files.get(cleaned);
  }
  const baseName = lowerName.split('/').pop();
  const fallbackPath = vfs.byBase.get(baseName);
  return fallbackPath ? vfs.files.get(fallbackPath) : null;
}

/* ---- content from a URL: a bounded fetch queue keeps the browser from opening dozens of requests at once ---- */

/** Shared download queue state (property names are used by other files): `n` active requests, `max` allowed in parallel, `q` queued start functions. */
MG.fetchQ = { n: 0, max: 4, q: [] };

/**
 * Downloads a URL as an ArrayBuffer through the bounded queue.
 * @param {string} url Address to fetch.
 * @returns {Promise<ArrayBuffer>} The response body; rejects on a non-2xx status.
 */
MG.fetchBuf = function (url) {
  return new Promise((resolve, reject) => {
    const queue = MG.fetchQ,
      startDownload = () => {
        queue.n++;
        fetch(url)
          .then(response => {
            if (!response.ok) throw new Error(response.status + ' ' + url);
            return response.arrayBuffer();
          })
          .then(resolve, reject)
          .finally(() => {
            queue.n--;
            // Hand the free slot to the next waiting download.
            const next = queue.q.shift();
            if (next) next();
          });
      };
    if (queue.n < queue.max) startDownload();
    else queue.q.push(startDownload);
  });
};

/**
 * Builds a VFS whose files are downloaded lazily from `baseUrl + path`.
 * @param {string} baseUrl URL prefix (normally ending in '/').
 * @param {string[]} paths Relative file paths below the prefix.
 * @returns {Promise<object>} The new VFS.
 */
MG.vfsFromUrls = (baseUrl, paths) =>
  MG.makeVfs(
    paths.map(path => ({
      path,
      read: () => MG.fetchBuf(baseUrl + path.split('/').map(encodeURIComponent).join('/'))
    }))
  );

/**
 * Lists a folder served with a plain directory index (python http.server, nginx autoindex, apache).
 * Only relative links are followed; absolute links, query links and "../" are ignored.
 * @param {string} baseUrl URL of the folder.
 * @param {number} maxDepth How many sub-folder levels to descend.
 * @returns {Promise<string[]>} File paths relative to `baseUrl`.
 */
MG.crawl = async function (baseUrl, maxDepth) {
  const files = [];
  const walk = async (dir, depth) => {
    let html;
    try {
      const response = await fetch(baseUrl + dir);
      if (!response.ok) return;
      html = await response.text();
    } catch (error) {
      return;
    }
    const hrefPattern = /href="([^"#?]+)"/gi;
    let match;
    const subDirs = [];
    while ((match = hrefPattern.exec(html))) {
      let href;
      try {
        href = decodeURIComponent(match[1]);
      } catch (error) {
        continue;
      }
      if (/^(\/|[a-z]+:|\.)/i.test(href)) continue;
      if (href.endsWith('/')) {
        if (depth < maxDepth) subDirs.push(href);
      } else files.push(dir + href);
    }
    for (const subDir of subDirs) await walk(dir + subDir, depth + 1);
  };
  await walk('', 0);
  return files;
};

/**
 * Runs an async function over all items with at most `concurrency` calls in flight.
 * @param {Array} items Work items.
 * @param {number} concurrency Maximum parallel workers.
 * @param {function(*): Promise<void>} worker Called once per item.
 * @returns {Promise<void>} Resolves when every item is done.
 */
MG.pool = async function (items, concurrency, worker) {
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex++];
        await worker(item);
      }
    })
  );
};
