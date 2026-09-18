// 개발용 서버: 앱 화면(public/)을 브라우저로 띄우고, 앱의 네이티브 HTTP 대신 /proxy 로 외부 요청을 대신 보낸다.
// 실제 휴대폰 앱은 이 서버 없이 동작한다.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, '..', 'public');
const PORT = Number(process.env.PORT || 5173);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };
const ALLOWED = /^https:\/\/(www\.youtube\.com|translate\.googleapis\.com|api\.mymemory\.translated\.net|api\.dictionaryapi\.dev|api\.github\.com|kevin-kim98\.github\.io)\//;

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/proxy' && req.method === 'POST') {
        const { url: target, method = 'GET', headers = {}, body, timeout = 15000 } = await readJson(req);
        if (!ALLOWED.test(target)) throw new Error('허용되지 않은 주소: ' + target);
        const r = await fetch(target, { method, headers, body, signal: AbortSignal.timeout(timeout) });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: r.status, text: await r.text() }));
      }
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const file = path.normalize(path.join(PUBLIC, rel));
      if (!file.startsWith(PUBLIC)) throw new Error('forbidden');
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(String(err.message));
    }
  })
  .listen(PORT, () => console.log(`개발 서버: http://localhost:${PORT}`));
