import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// The one applet this host opens, pinned by the hash of the bytes it ships. The kernel refuses any
// bytes that do not hash to it, so a changed or swapped applet.html is never run.
const applet = readFileSync(new URL('./public/applet.html', import.meta.url));
const appletSha256 = createHash('sha256').update(applet).digest('hex');

export default defineConfig({
  base: './',
  define: { __APPLET_SHA256__: JSON.stringify(appletSha256) },
  preview: { port: Number(process.env.MINIMAL_HOST_PORT ?? 4180) },
});
