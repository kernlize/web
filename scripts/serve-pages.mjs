#!/usr/bin/env node
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const artifactRoot = resolve(repoRoot, process.env.PAGES_OUT_DIR || '.pages');
const previewPath = withSlashes(process.env.PAGES_PREVIEW_PATH || '/');
const host = process.env.HOST || '127.0.0.1';
const port = Number.parseInt(process.env.PORT || process.env.PAGES_PORT || process.env.PAGES_PREVIEW_PORT || '4178', 10) || 4178;

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.xml', 'application/xml; charset=utf-8'],
]);

function withSlashes(path) {
  const trimmed = path.replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}/` : '/';
}

function sendText(response, status, body) {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(body);
}

function redirect(response, location) {
  response.writeHead(302, { location });
  response.end();
}

function resolveFile(pathname) {
  const publicPath = decodeURIComponent(pathname.slice(previewPath.length));
  const normalized = normalize(publicPath || 'index.html').replace(/^(\.\.[/\\])+/, '');
  let filePath = resolve(artifactRoot, normalized);
  const inside = relative(artifactRoot, filePath);
  if (inside.startsWith('..') || inside.includes(`..${sep}`)) return { status: 403 };
  if (!existsSync(filePath) && existsSync(`${filePath}.html`)) filePath = `${filePath}.html`;
  if (!existsSync(filePath)) return { status: 404 };
  if (statSync(filePath).isDirectory()) {
    if (!pathname.endsWith('/')) return { redirect: `${pathname}/` };
    filePath = join(filePath, 'index.html');
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return { status: 404 };
  return { filePath };
}

/**
 * Swap an HTML page for its Markdown twin when the client asks for Markdown.
 * Every built page has a sibling `index.md` (or `<name>.md` in the docs), so agents
 * sending `Accept: text/markdown` get the same content without HTML.
 */
function negotiate(filePath, accept) {
  if (!filePath.endsWith('.html') || !/\btext\/markdown\b/.test(accept || '')) return filePath;
  const twin = filePath.replace(/\.html$/, '.md');
  return existsSync(twin) ? twin : filePath;
}

function handleRequest(request, response) {
  const url = new URL(request.url || '/', `http://${host}`);
  if (previewPath !== '/' && (url.pathname === '/' || `${url.pathname}/` === previewPath)) {
    redirect(response, previewPath);
    return;
  }
  if (!url.pathname.startsWith(previewPath)) {
    sendText(response, 404, 'Not found\n');
    return;
  }
  const result = resolveFile(url.pathname);
  if (result.redirect) {
    redirect(response, result.redirect);
    return;
  }
  if (result.status) {
    sendText(response, result.status, result.status === 403 ? 'Forbidden\n' : 'Not found\n');
    return;
  }
  const filePath = negotiate(result.filePath, request.headers.accept);
  response.writeHead(200, {
    'content-type': contentTypes.get(extname(filePath)) || 'application/octet-stream',
    vary: 'Accept',
  });
  createReadStream(filePath).pipe(response);
}

if (!existsSync(artifactRoot)) {
  throw new Error(`[serve-pages] missing ${relative(repoRoot, artifactRoot)}; run pnpm site:build first`);
}

createServer(handleRequest).listen(port, host, () => {
  console.log(`kernl pages preview: http://${host}:${port}${previewPath}`);
});
