import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const distDir = path.join(root, 'dist');
const publicDir = path.join(root, 'public');
const port = Number(process.env.PREVIEW_PORT || 4173);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
};

const safeFile = (dir, rel) => {
  const full = path.resolve(dir, `.${rel}`);
  return full.startsWith(dir + path.sep) && fs.statSync(full, { throwIfNoEntry: false })?.isFile() ? full : null;
};

http.createServer((req, res) => {
  const reqPath = decodeURIComponent(new URL(req.url || '/', 'http://127.0.0.1').pathname);
  const filePath = safeFile(distDir, reqPath) ?? safeFile(publicDir, reqPath) ?? path.join(distDir, 'index.html');
  if (!fs.existsSync(filePath)) {
    res.writeHead(404).end('Not found');
    return;
  }
  if (reqPath.startsWith('/ort/') || reqPath.startsWith('/models/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  }
  res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`Serving dist on http://127.0.0.1:${port}`));
