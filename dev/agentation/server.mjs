import http from 'node:http';
import { prepareContentPreview } from './content-preview.mjs';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '../..');
const port = Number(process.env.ASIDE_PREVIEW_PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid ASIDE_PREVIEW_PORT');
const origin = `http://127.0.0.1:${port}`;
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const toolbar = await build({
  entryPoints: [resolve(here, 'toolbar.jsx')], bundle: true, write: false,
  format: 'iife', platform: 'browser', minify: true,
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{
    name: 'agentation-modal-portals',
    setup(builder) {
      builder.onResolve({ filter: /^react-dom$/ }, args => {
        if (/[\\/]node_modules[\\/]agentation[\\/]/.test(args.importer)) {
          return { path: resolve(here, 'portal-adapter.js') };
        }
      });
    },
  }],
});
const script = '<script src="/__agentation/toolbar.js" defer></script>';
const shim = '<script src="/__agentation/browser-preview.js"></script>';
const sources = ['movie-notes-extension', 'movie-notes-pwa'];
const roots = await Promise.all(sources.map(name => realpath(resolve(project, name))));

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

// Serve only frontend assets from the two source folders, never project files, keys or backups.
const server = http.createServer(async (req, res) => {
  try {
    const host = new URL(`http://${req.headers.host}`).hostname;
    if (!['localhost', '127.0.0.1'].includes(host)) return send(res, 403, 'text/plain', 'Forbidden host');
    if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, 'text/plain', 'Method not allowed');
    const url = new URL(req.url, origin);
    const path = decodeURIComponent(url.pathname);
    if (path === '/') {
      res.writeHead(302, { Location: '/movie-notes-extension/panel.html' });
      return res.end();
    }
    if (path === '/__agentation/toolbar.js') return send(res, 200, mime['.js'], toolbar.outputFiles[0].contents);
    if (path === '/__agentation/browser-preview.js') return send(res, 200, mime['.js'], await readFile(resolve(here, 'browser-preview.js')));
    const sceneFiles = {'/__agentation/scene.html':'scene.html','/__agentation/scene.js':'scene.js','/__agentation/scene.css':'scene.css'};
    if (sceneFiles[path]) {
      let body = await readFile(resolve(here, sceneFiles[path]), 'utf8');
      if (path.endsWith('.html')) body = body.replace('</body>', `${script}</body>`);
      return send(res, 200, mime[extname(path)], body);
    }
    if (path === '/__agentation/content-preview.js') {
      // Only this development route presents the local video fixture as a supported site.
      // All interaction code is read from the real extension on every request.
      const content = prepareContentPreview(await readFile(resolve(project,'movie-notes-extension/content.js'),'utf8'));
      return send(res,200,mime['.js'],content);
    }
    const pieces = path.slice(1).split('/');
    const index = sources.indexOf(pieces.shift());
    if (index < 0 || pieces.some(p => p.startsWith('.') || p.includes('\\'))) return send(res, 404, 'text/plain', 'Not found');
    if (pieces.at(-1) === '') pieces.push(index === 0 ? 'panel.html' : 'index.html');
    const extension = extname(pieces.at(-1));
    const type = path === '/movie-notes-pwa/manifest.json' ? 'application/manifest+json' : mime[extension];
    if (!type) return send(res, 404, 'text/plain', 'Not found');
    const file = await realpath(resolve(roots[index], ...pieces));
    if (!file.startsWith(roots[index] + sep)) return send(res, 403, 'text/plain', 'Forbidden path');
    // A local preview must not install the PWA's offline cache over development assets.
    if (path === '/movie-notes-pwa/sw.js') {
      return send(res, 200, mime['.js'], 'self.addEventListener("install",()=>self.skipWaiting()); self.addEventListener("activate",event=>event.waitUntil(self.registration.unregister()));');
    }
    let body = await readFile(file);
    if (extension === '.html') {
      body = body.toString();
      if (index === 0) body = body.replace('</head>', `${shim}</head>`);
      body = body.replace('</body>', `${script}</body>`);
    }
    send(res, 200, type, body);
  } catch (error) {
    const status = ['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : error instanceof URIError ? 400 : 500;
    if (status === 500) console.error(error);
    send(res, status, 'text/plain', status === 404 ? 'Not found' : 'Preview request failed');
  }
});

async function healthy() {
  try {
    const response = await fetch('http://127.0.0.1:4747/health', { signal: AbortSignal.timeout(1000) });
    const body = await response.json();
    return response.ok && body.status === 'ok' && body.mode === 'local';
  } catch { return false; }
}

// Codex and this preview share the official local HTTP API and persisted annotation store.
await new Promise((done, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', done);
}).catch(error => {
  console.error(`无法启动本地预览 (${port}): ${error.message}`);
  process.exit(1);
});
if (!await healthy()) {
  const { startHttpServer } = await import('agentation-mcp');
  startHttpServer(4747);
  for (let attempt = 0; attempt < 20 && !await healthy(); attempt++) {
    await new Promise(done => setTimeout(done, 150));
  }
  if (!await healthy()) {
    console.error('Agentation 4747 端口不可用，请检查端口占用后重启。');
    process.exit(1);
  }
}
console.log(`旁白 + Agentation: ${origin}/movie-notes-extension/panel.html`);
console.log(`PWA + Agentation: ${origin}/movie-notes-pwa/index.html`);
console.log('页面右下角开启标注。修改业务源码后刷新页面；Ctrl+C 关闭预览。');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => process.exit(0));
