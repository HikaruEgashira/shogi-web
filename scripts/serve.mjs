import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { headers } from './web-headers.mjs';
const mime = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.gz': 'application/gzip' };
// Serves a directory with the production headers; port 0 lets tests take any free port.
export async function serve(directory, port = 0) {
  const root = resolve(directory);
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
      const body = await readFile(file);
      response.writeHead(200, { ...headers, 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch { response.writeHead(404, headers).end('Not found'); }
  }).listen(port, '127.0.0.1');
  await once(server, 'listening');
  return server;
}
if (import.meta.main) {
  const directory = process.argv[2] || 'public';
  const server = await serve(directory, 8795);
  console.log(`http://127.0.0.1:${server.address().port} (${resolve(directory)})`);
}
