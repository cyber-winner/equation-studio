import http from 'node:http';
import { readFile } from 'node:fs/promises';

const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/src/styles.css', ['src/styles.css', 'text/css']],
  ['/src/app.js', ['src/app.js', 'text/javascript']],
  ['/src/trace.js', ['src/trace.js', 'text/javascript']],
  ['/src/high-detail.js', ['src/high-detail.js', 'text/javascript']],
  ['/src/worker.js', ['src/worker.js', 'text/javascript']],
  ['/src/tile-worker.js', ['src/tile-worker.js', 'text/javascript']],
]);
const port = Number(process.env.PORT || 5173);
http.createServer(async (request, response) => {
  try {
    const file = files.get(new URL(request.url, 'http://localhost').pathname);
    if (!file || !['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(404).end('Not found');
      return;
    }
    const content = await readFile(new URL(file[0], import.meta.url));
    response.writeHead(200, {
      'Content-Type': `${file[1]}; charset=utf-8`,
      'Cache-Control': 'no-cache',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    response.writeHead(500).end('Unable to serve application');
  }
}).listen(port, '127.0.0.1', () => console.log(`Equation Studio: http://localhost:${port}`));
