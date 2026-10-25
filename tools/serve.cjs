// Local static server for development: binds to 127.0.0.1 only and serves the same public
// files GitHub Pages publishes. Read-only: GET/HEAD, no query strings, nothing is logged or stored.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 4173;
const PUBLIC = [/^index\.html$/, /^sw\.js$/, /^(web|pdf-parser|cloud)\/[^]+$/];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};
const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store'
};

function reply(res, status, body = '', type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { ...HEADERS, 'Content-Type': type });
  res.end(body);
}

http
  .createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'Method not allowed');
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.search) return reply(res, 400, 'Query strings are not accepted');
    if (url.pathname === '/') return res.writeHead(302, { ...HEADERS, Location: '/web/' }).end();
    let rel;
    try {
      rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    } catch {
      return reply(res, 400, 'Bad path');
    }
    if (rel.endsWith('/') || rel === '') rel += 'index.html';
    const file = path.resolve(ROOT, rel);
    const inside = path.relative(ROOT, file).split(path.sep).join('/');
    if (inside.startsWith('..') || !PUBLIC.some(re => re.test(inside))) return reply(res, 404, 'Not found');
    try {
      const body = await fs.readFile(file);
      res.writeHead(200, {
        ...HEADERS,
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream'
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      reply(res, 404, 'Not found');
    }
  })
  .listen(PORT, '127.0.0.1', () => console.log(`Serving on http://127.0.0.1:${PORT}/web/ (Ctrl+C to stop)`));
