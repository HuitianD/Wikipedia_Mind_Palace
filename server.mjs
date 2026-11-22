// Local dev server: serves the static site and the /api functions, like Vercel does.
//   npm run dev        → http://localhost:8000
// Put ANTHROPIC_API_KEY in .env (see .env.example) to turn on Claude suggestions.
// Without it, the site still works and falls back to keyword suggestions.
// Put MONGODB_URI and STUDY_ADMIN_KEY there to save study sessions to MongoDB.
// Without them, study sessions are kept in the browser that ran them.
// Put GOOGLE_CLIENT_ID there to require a Brown sign-in before Claude is used (lib/access.js).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import suggest from './api/suggest.js';
import study from './api/study.js';
import auth from './api/auth.js';
import { accessConfig } from './lib/access.js';

const API = { '/api/suggest': suggest, '/api/study': study, '/api/auth': auth };

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8000;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const PRIVATE = /^\/(node_modules|lib|scripts|\.env|\.git|\.claude|server\.mjs|package)/;

function vercelLikeResponse(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); return res; };
  return res;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (Object.hasOwn(API, url.pathname)) {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 2_000_000) { res.writeHead(413).end(); return; }
    }
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
    return API[url.pathname](req, vercelLikeResponse(res));
  }

  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(root, path.normalize(rel));
  if (!file.startsWith(root) || PRIVATE.test(rel)) { res.writeHead(404).end('Not found'); return; }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Referrer-Policy': 'no-referrer-when-downgrade', // Google's sign-in button needs this on http://localhost
    });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, () => {
  const cfg = accessConfig();
  const ai = { off: 'no API key: keyword suggestions only', open: 'Claude suggestions on for everyone (no GOOGLE_CLIENT_ID)', signin: `Claude suggestions after sign-in (${cfg.domains.join(', ')}; ${cfg.dailyLimit} a day each)` }[cfg.claude];
  const db = process.env.MONGODB_URI ? 'study sessions saved to MongoDB' : 'no MONGODB_URI: study sessions stay in the browser';
  console.log(`Mind Palace on http://localhost:${PORT}  (${ai}; ${db})`);
});
