<script lang="ts">
  import type { Snippet } from 'svelte';
  import { trapFocus } from './focus-trap';

  interface Props {
    title: string;
    onclose: () => void;
    wide?: boolean;
    children: Snippet;
  }

  const { title, onclose, wide = false, children }: Props = $props();
  const headingId = `overlay-${Math.random().toString(36).slice(2, 8)}`;
</script>

<div class="backdrop" onpointerdown={(event) => event.target === event.currentTarget && onclose()}>
  <section class="panel" class:wide role="dialog" aria-modal="true" aria-labelledby={headingId} {@attach trapFocus()}>
    <header>
      <h2 id={headingId}>{title}</h2>
      <button type="button" class="shell-button quiet" onclick={onclose} aria-label="Close {title}">Close</button>
    </header>
    <div class="body">
      {@render children()}
    </div>
  </section>
</div>

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    z-index: 200;
    background: color-mix(in srgb, var(--bg-sunken) 55%, transparent);
    backdrop-filter: blur(3px);
    display: grid;
    place-items: start center;
    padding: 4.5rem 1rem 1rem;
    overflow: auto;
  }

  .panel {
    width: min(100%, 34rem);
    max-height: calc(100% - 1rem);
    display: grid;
    grid-template-rows: auto 1fr;
    background: var(--bg-raised);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
    animation: rise 200ms var(--ease);
  }

  .panel.wide {
    width: min(100%, 52rem);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1.25rem 0.75rem;
    border-bottom: 1px solid var(--line);
  }

  h2 {
    font-size: 1.15rem;
    margin: 0;
  }

  .body {
    padding: 1rem 1.25rem 1.25rem;
    overflow: auto;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .panel {
      animation: none;
    }
  }
</style>
