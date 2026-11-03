<script lang="ts">
  import { encode } from 'uqr';

  /** The pairing string lives only in the QR and the clipboard: it names the protocol (D-006). */
  const { code }: { code: string } = $props();

  const BORDER = 2;
  const qr = $derived(encode(code, { ecc: 'M', border: BORDER }));
  const path = $derived(
    qr.data.flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : ''))).join(''),
  );
  let copied = $state<'idle' | 'done' | 'failed'>('idle');

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      copied = 'done';
    } catch {
      copied = 'failed';
    }
  }
</script>

<figure class="pairing">
  <svg viewBox="0 0 {qr.size} {qr.size}" role="img" aria-label="Pairing code as a QR code" shape-rendering="crispEdges">
    <rect width={qr.size} height={qr.size} fill="#fff" />
    <path d={path} fill="#000" />
  </svg>
  <figcaption class="shell-muted">Scan this with your signer app, or copy the code and paste it there.</figcaption>
  <div class="shell-actions">
    <button type="button" class="shell-button" onclick={copy}>Copy pairing code</button>
    <span class="shell-muted" role="status">{copied === 'done' ? 'Copied.' : copied === 'failed' ? 'This browser would not copy. Scan the code instead.' : ''}</span>
  </div>
</figure>

<style>
  .pairing {
    margin: 0;
    display: grid;
    gap: 0.75rem;
    justify-items: start;
  }

  svg {
    width: min(100%, 14rem);
    height: auto;
    border-radius: 8px;
  }

  figcaption {
    font-size: 0.9rem;
  }
</style>
