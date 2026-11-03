import type { AppletSummary, SampleApplet } from './contract';

const PUBLISHER = '7f3a9c1e5b2d4a6f8e0c1b3d5f7a9c2e4b6d8f0a1c3e5b7d9f1a3c5e7b9d0f2c';
const SERVERS = ['https://cdn.example.net'];

interface SampleSpec {
  readonly address: string;
  readonly dTag: string;
  readonly hash: string;
  readonly title: string;
  readonly description: string;
  readonly blurb: string;
  readonly requires: readonly string[];
  readonly optional: readonly string[];
}

const SPECS: readonly SampleSpec[] = [
  {
    address: 'preview:notes',
    dTag: 'notes',
    hash: 'a1c3e5b7d9f1a3c5e7b9d0f2c4a6b8d0e2f4a6c8e0b2d4f6a8c0e2b4d6f8a0c2',
    title: 'Notes',
    description: 'Write short notes and publish them to your network. Every publish and every deletion is shown to you before it happens.',
    blurb: 'Publishing, deleting and the consent dialog.',
    requires: ['relay', 'identity'],
    optional: ['notify', 'storage'],
  },
  {
    address: 'preview:pulse',
    dTag: 'pulse',
    hash: 'b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a6c8e0b2d4',
    title: 'Pulse',
    description: 'A live view of what your connections are up to. Reads from the network constantly, which is exactly what the guard is for.',
    blurb: 'Flooding the shell and watching the guard respond.',
    requires: ['relay'],
    optional: ['notify', 'media', 'resource'],
  },
];

function summaryOf(spec: SampleSpec): AppletSummary {
  return {
    identity: { dTag: spec.dTag, hash: spec.hash },
    title: spec.title,
    description: spec.description,
    publisher: PUBLISHER,
    requires: spec.requires,
    optional: spec.optional,
    archetypes: [],
    source: 'https://kernlize.github.io/docs/',
    manifest: {
      format: 'current',
      artifactHash: spec.hash,
      optional: [...spec.optional],
      kind: 35129,
      pubkey: PUBLISHER,
      dTag: spec.dTag,
      catalogId: `${PUBLISHER}:${spec.dTag}`,
      paths: [{ path: '/index.html', sha256: spec.hash }],
      aggregateHash: spec.hash,
      servers: [...SERVERS],
      requires: [...spec.requires],
      archetypes: [],
      title: spec.title,
      description: spec.description,
    },
  };
}

export const SAMPLES: readonly SampleApplet[] = SPECS.map(({ address, title, blurb }) => ({ address, title, blurb }));

/** The summary for a preview address, or undefined when the address is not a sample. */
export function sampleSummary(address: string): AppletSummary | undefined {
  const spec = SPECS.find((candidate) => candidate.address === address.trim().toLowerCase());
  return spec && summaryOf(spec);
}

export function sampleAddressOf(identity: { readonly dTag: string }): string | undefined {
  return SPECS.find((spec) => spec.dTag === identity.dTag)?.address;
}

export interface PreviewAppletInput {
  readonly title: string;
  readonly csp: string;
  readonly domains: readonly string[];
  readonly domainLabels: readonly string[];
  readonly identity: string;
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);

interface Action {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly domain?: string;
}

const ACTIONS: readonly Action[] = [
  { id: 'publish', label: 'Publish a note', hint: 'asks you first', domain: 'relay' },
  { id: 'delete', label: 'Delete a note', hint: 'asks you first, marked destructive', domain: 'relay' },
  { id: 'notify', label: 'Send a notification', hint: 'needs the notifications grant', domain: 'notify' },
  { id: 'flood', label: 'Flood the shell', hint: '40 network reads at once; watch the guard', domain: 'relay' },
  { id: 'link', label: 'Open a link', hint: 'the shell confirms before leaving' },
];

function actionButton(action: Action, domains: readonly string[]): string {
  const missing = action.domain !== undefined && !domains.includes(action.domain);
  return `<li><button type="button" data-action="${action.id}" ${missing ? 'data-missing="1"' : ''}>${escapeHtml(action.label)}</button><span>${escapeHtml(action.hint)}${missing ? ' (not granted)' : ''}</span></li>`;
}

const SCRIPT = `
const list = document.getElementById('log');
const log = (text, tone) => {
  const item = document.createElement('li');
  item.textContent = text;
  if (tone) item.dataset.tone = tone;
  list.prepend(item);
  while (list.children.length > 12) list.lastChild.remove();
};
const send = (action, extra) => parent.postMessage(Object.assign({ kernlPreview: action }, extra || {}), '*');
window.addEventListener('message', (event) => {
  if (event.source !== parent) return;
  const data = event.data;
  if (!data || data.kernlPreview !== 'result') return;
  log(data.text, data.ok ? 'ok' : 'warn');
});
let count = 0;
const handlers = {
  publish: () => send('publish', { text: document.getElementById('note').value || 'Hello from the preview applet.' }),
  delete: () => send('delete', { text: 'Hello from the preview applet.' }),
  notify: () => send('notify', { text: 'The preview applet says hello.' }),
  flood: () => { for (let i = 0; i < 40; i += 1) send('subscribe', { seq: ++count }); log('Sent 40 network reads at once.'); },
  link: () => send('link', { url: 'https://kernlize.github.io/docs/' }),
};
document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', () => handlers[button.dataset.action]());
});
send('hello');
`;

const STYLE = `
:root { color-scheme: light dark; }
body { margin: 0; font: 15px/1.5 system-ui, sans-serif; background: #f6f3ec; color: #16181c; padding: 20px; }
header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 16px; }
h1 { font-size: 20px; margin: 0; }
.tag { font: 12px ui-monospace, monospace; opacity: .7; }
.card { background: #fff; border: 1px solid #ddd6c6; border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; }
.card p { margin: 0 0 10px; }
ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.actions li { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: center; }
.actions span { font-size: 13px; opacity: .75; }
button { font: inherit; padding: 6px 12px; border-radius: 999px; border: 1px solid #b9b1a0; background: #fff; cursor: pointer; }
button[data-missing] { opacity: .55; }
textarea { width: 100%; box-sizing: border-box; font: inherit; border-radius: 8px; border: 1px solid #b9b1a0; padding: 8px; background: transparent; color: inherit; resize: vertical; }
#log { font: 13px ui-monospace, monospace; }
#log li[data-tone=ok] { color: #237a47; }
#log li[data-tone=warn] { color: #9a5b00; }
@media (prefers-color-scheme: dark) { body { background: #12151b; color: #e9e4d8; } .card { background: #1a1e26; border-color: #2b303b; } button { background: #242933; color: inherit; border-color: #3a4050; } textarea { border-color: #3a4050; } #log li[data-tone=ok] { color: #8fd8a6; } #log li[data-tone=warn] { color: #f0b85a; } }
`;

/** The static document the preview mounts instead of verified applet bytes. */
export function renderPreviewApplet(input: PreviewAppletInput): string {
  const granted = input.domainLabels.length ? input.domainLabels.join(', ') : 'nothing beyond the baseline';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(input.csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header><h1>${escapeHtml(input.title)}</h1><span class="tag">preview applet · ${escapeHtml(input.identity)}</span></header>
<section class="card">
<p>This applet runs in a sealed frame with no network of its own. It can only ask the shell, and the shell can say no. Granted: <strong>${escapeHtml(granted)}</strong>.</p>
<textarea id="note" rows="2" aria-label="Note to publish">Hello from the preview applet.</textarea>
</section>
<section class="card">
<ul class="actions">${ACTIONS.map((action) => actionButton(action, input.domains)).join('')}</ul>
</section>
<section class="card"><ul id="log" aria-live="polite"></ul></section>
<script>${SCRIPT}</script>
</body>
</html>`;
}
