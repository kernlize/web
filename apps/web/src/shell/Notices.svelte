<script lang="ts">
  import type { NoticeStore } from './notice-store.svelte';

  const { notices }: { notices: NoticeStore } = $props();
</script>

<div class="notices" aria-live="polite" aria-relevant="additions">
  {#each notices.items as notice (notice.id)}
    <article class="notice" class:warning={notice.tone === 'warning'}>
      <div class="text">
        <strong>{notice.title}</strong>
        {#if notice.body}<p>{notice.body}</p>{/if}
      </div>
      <button type="button" class="shell-button quiet" onclick={() => notices.dismiss(notice.id)} aria-label="Dismiss notice: {notice.title}">Dismiss</button>
    </article>
  {/each}
</div>

<style>
  .notices {
    position: absolute;
    right: 1rem;
    bottom: 1rem;
    z-index: 400;
    display: grid;
    gap: 0.5rem;
    width: min(22rem, calc(100% - 2rem));
    pointer-events: none;
  }

  .notice {
    pointer-events: auto;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.5rem;
    align-items: start;
    background: var(--bg-raised);
    border: 1px solid var(--line-strong);
    border-left: 3px solid var(--ok);
    border-radius: 12px;
    padding: 0.75rem 0.75rem 0.75rem 1rem;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.3);
    animation: slide 200ms var(--ease);
  }

  .notice.warning {
    border-left-color: var(--accent);
  }

  .text {
    display: grid;
    gap: 0.2rem;
    font-size: 0.92rem;
  }

  p {
    margin: 0;
    color: var(--ink-muted);
    font-size: 0.85rem;
  }

  @keyframes slide {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .notice {
      animation: none;
    }
  }
</style>
