#!/usr/bin/env node
/**
 * Tiny static server for local play.
 *
 * Usage: node tools/serve.js [dir] [port]      (npm run serve)
 * Needs: Node.js only.
 *
 * Serves dist/ by default (the game plus dist/assets) on port 8080. Adds a directory index, so a content
 * folder works even without manifest.json. CORS is open (`Access-Control-Allow-Origin: *`).
 */
const http = require('http'),
  fs = require('fs'),
  path = require('path');

const rootDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist')),
  port = +(process.argv[3] || 8080);

/** Content-Type by lowercase file extension; anything else is served as application/octet-stream. */
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg'
};

const server = http.createServer((request, response) => {
  const urlPath = decodeURIComponent(request.url.split('?')[0]),
    filePath = path.join(rootDir, path.normalize(urlPath));
  // Refuse paths that escape the served root (../ traversal).
  if (!filePath.startsWith(rootDir)) {
    response.writeHead(403);
    return response.end();
  }
  fs.stat(filePath, (error, stats) => {
    const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
    if (error) {
      response.writeHead(404, corsHeaders);
      return response.end('not found');
    }
    if (stats.isDirectory()) {
      // Directories need a trailing slash so relative links resolve.
      if (!urlPath.endsWith('/')) {
        response.writeHead(301, { Location: urlPath + '/' });
        return response.end();
      }
      const indexPath = path.join(filePath, 'index.html');
      if (fs.existsSync(indexPath)) {
        response.writeHead(200, { ...corsHeaders, 'Content-Type': mimeTypes['.html'] });
        return fs.createReadStream(indexPath).pipe(response);
      }
      // No index.html: generate a plain HTML listing.
      const listItems = fs
        .readdirSync(filePath, { withFileTypes: true })
        .map(
          entry =>
            '<li><a href="' +
            encodeURIComponent(entry.name) +
            (entry.isDirectory() ? '/' : '') +
            '">' +
            entry.name +
            (entry.isDirectory() ? '/' : '') +
            '</a></li>'
        )
        .join('');
      response.writeHead(200, { ...corsHeaders, 'Content-Type': mimeTypes['.html'] });
      return response.end(
        '<!doctype html><title>Index of ' +
          urlPath +
          '</title><h1>Index of ' +
          urlPath +
          '</h1><ul>' +
          listItems +
          '</ul>'
      );
    }
    response.writeHead(200, {
      ...corsHeaders,
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stats.size
    });
    fs.createReadStream(filePath).pipe(response);
  });
});
server.listen(port, () =>
  console.log('serving ' + rootDir + ' at http://localhost:' + server.address().port + '/immortals-kombat.html')
);
