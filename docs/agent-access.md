# Agent access

How an AI agent should read these docs. This page describes website plumbing only; it is not part of any protocol.

## What is served

Everything below is relative to the docs root, `/docs/` by default. On the kernl.run deployment the root is `https://kernl.run/docs/`.

| Want | Fetch |
| --- | --- |
| An index of every docs page, grouped like the sidebar, with one-line descriptions | `/docs/llms.txt` ([llmstxt.org](https://llmstxt.org/) format) |
| Every docs page in one file | `/docs/llms-full.txt` |
| One page as Markdown | The page path with `.md`: `/docs/index.md`, `/docs/concepts/guard.md`, `/docs/packages/index.md` |
| The generated API reference | `/docs/api/index.html` and `/docs/api/modules/_kernlize_<package>.html`; HTML only |
| The landing site's own index | `/llms.txt` and `/llms-full.txt` at the site root, built by the Astro site |

## Markdown twins

Every HTML page on this docs site has a Markdown twin at a fixed path, generated at build time from the same source as the HTML:

- A page served at `/docs/concepts/guard` (or `/docs/concepts/guard.html`) has its twin at `/docs/concepts/guard.md`.
- A directory page such as `/docs/packages/` has its twin at `/docs/packages/index.md`.
- The docs root `/docs/` has its twin at `/docs/index.md`.

Each HTML page names its twin in `<head>`:

```html
<link rel="alternate" type="text/markdown" href="/docs/concepts/guard.md">
```

In the twins, frontmatter is removed, `:::` containers become blockquotes with a bold label, and internal links are rewritten to absolute `.md` URLs so a twin can be read on its own. Links into the generated API reference keep their `.html` extension because TypeDoc output has no Markdown form.

## Reading order

1. Fetch `/docs/llms.txt` and pick the section you need. The sections mirror the sidebar: Start, Concepts, Tutorials, How-tos, Packages, Reference, Policies.
2. For a question about behaviour, read the concept page first (for example `/docs/concepts/guard.md`), then the how-to.
3. For a question about an export, read the package page (`/docs/packages/<name>.md`) for the version, install line and export list, then the TypeDoc module page for signatures.
4. Treat `/docs/alpha-status.md` as authoritative about what is implemented. A contract described in a concept page may be an interface without a backend; the status page says which.

## What these docs are not

They are not the protocol. NIP-5D is specified in [nostr-protocol/nips PR #2303](https://github.com/nostr-protocol/nips/pull/2303) and the NAP domains in [napplet/naps](https://github.com/napplet/naps). Where a kernl page and the specification disagree, the specification wins and the page has a bug; see [Spec conformance](./policies/spec-conformance.md).

They are also not the public website. The landing site at `/` follows the [public vocabulary](./policies/public-vocabulary.md) rule and never names a protocol. These pages name everything precisely because developers need the names.

## Build contract

`llms.txt`, `llms-full.txt` and the twins are written by `docs/.vitepress/agent-output.ts` in VitePress's `buildEnd` hook. `scripts/audit-docs.mjs` fails the build when any of them is missing, so their presence is part of `pnpm docs:check`, not a convention.
