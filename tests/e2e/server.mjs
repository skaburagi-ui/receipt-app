// E2E用の小さな静的サーバー。dist/ を配信し、dist/_headers（= public/_headers）と同じレスポンスヘッダーを付ける。
// 本番（Cloudflare Workers Static Assets）の _headers 相当を再現し、CSP下の動作を確認するためのもの。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd(), 'dist');
const port = Number(process.env.E2E_PORT || 4180);
const noCsp = process.env.E2E_NO_CSP === '1';

function parseHeaders() {
  const txt = fs.readFileSync(path.join(root, '_headers'), 'utf8');
  const headers = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = /^\s+([A-Za-z-]+):\s*(.+)$/.exec(line);
    if (m) headers[m[1]] = m[2].trim();
  }
  return headers;
}
const hdrs = parseHeaders();
if (noCsp) delete hdrs['Content-Security-Policy'];
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { ...hdrs, 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { ...hdrs, 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`e2e server http://127.0.0.1:${port} csp=${!noCsp}`));
