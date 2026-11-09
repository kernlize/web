# Messages Applet Agent Guide

This directory is one NIP-5D napplet: kernl's direct-message applet. It talks to
the shell through NAP-DM and nothing else for messages. Keep it small,
framework-free, and on the napplet side of the shell boundary. `README.md` has
the boundary table, the layout tiers and the known package gaps.

## Before Editing

1. Install the current `napplet-*` agent skills with the skills.sh CLI
   (`npx skills add napplet/napplet`) and follow `napplet-make` for
   agent-driven napplet work. This template vendors no skill bodies.
2. Read `docs/context-map.md`.
3. Read the boundary document for the surface you are changing:
   - `docs/boundaries.md`
   - `docs/design-patterns.md`
   - `docs/package-surfaces.md`
4. If changing protocol assumptions, verify against the living NIP-5D reference
   in `docs/nip-5d.md`.
5. If the change appears to need a new NAP name, message domain, or numbered
   wire format, read `docs/new-nap-proposals.md` before writing code.

## Hard Boundaries

- Do not add shell implementation code to this template.
- Do not access signer keys, relay pools, cookies, service workers, or host DOM
  directly from napplet code.
- Do not use `localStorage` or `sessionStorage` for durable app state. Use
  `@napplet/sdk` storage helpers.
- Do not use direct `fetch`, `WebSocket`, or `EventSource`. NAP-CONNECT (the
  direct-network grant model) is currently deferred on the NAPs track, so there
  is no active direct-network surface. Use `resource.bytes()` for read-only
  external bytes.
- Do not import `@napplet/shim` from napplet code. The shell/runtime injects
  `window.napplet`; app calls use `@napplet/sdk`, while direct domain properties
  are only optional-domain availability checks.
- Use OUTBOX for normal Nostr reads and publishes. Use RELAY only when a feature
  names an explicit relay-local escape hatch.
- Add a domain to manifest `requires` only when the napplet cannot perform its
  core task without it. Guard optional domains and provide a graceful fallback.
- Do not invent app-local NAP names, numbers, or JSON envelope domains. Open a
  proposal PR to `napplet/naps` only after the guardrails in
  `docs/new-nap-proposals.md` are satisfied.
- Every request to the shell goes through `src/shell.ts` and its pacer. A
  strict shell silently drops what an applet sends over its budget, so no other
  module imports a callable SDK binding, nothing is requested in a burst, and
  no thread's history is read at startup. Reads may be repeated; a send never.
- Direct messages go through `dm` only. Never parse or display a conversation
  id, never pass one on a direct send, and never time a send out: the shell
  picks the route and may ask the person first.
- Every string a person can read or have read to them uses the shell's
  vocabulary: applet, account, account id, provider, shell, network. No protocol
  or framework names in the interface.
- No `<form>` elements. The frame is sandboxed without form submission, so a
  submit event never fires; handle the button and the Enter key directly.

## Applet, Not Web Page

- Do not render the napplet's name, a tagline, an eyebrow, a masthead, or a
  footer. The runtime shows the name; the frame is working surface from the
  first pixel.
- Keep the compact defaults in `src/styles.css` (13px type, 4/8/12px spacing,
  28px controls, no page margins, no max-width column) unless the product has a
  written reason to change them.
- The napplet can be placed at any size and resized live. Keep the tiers in
  `src/tiers.css` (`tiny` < 240px, `compact`, `regular` from 480px, `wide` above
  900px, short frames) working; `pnpm test:frames` checks `200×160`, `320×560`,
  `900×600`, and `2400×1200` in a dark and a light theme.
- There is no minimum size; the applet degrades to avatar tiles instead.
- Apply the runtime theme to the whole surface (`html`, `body`, `#app`, and
  every derived token), as `applyTheme` in `src/theme.ts` does.

## Verification

Run these before claiming completion:

```bash
pnpm verify            # guidance + unit tests + type-check + build
pnpm test:conformance
pnpm test:frames       # built artifact on a stub shell: four frames, two themes
```

`test:conformance` loads the built napplet in a real `allow-scripts` iframe.
Read its report: manifest, wire, and lifecycle checks skip when their evidence
is not supplied. Use `pnpm test:conformance:ui` for the live runtime.

Use `pnpm dev` for shell/manual testing. A passing browser smoke test should
cover iframe load, injected-domain display, and at least one user-triggered SDK
operation in the target shell. Also verify that missing optional domains disable
only their enhancements without crashing the napplet.
