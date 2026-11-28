<script lang="ts">
  import type { Ask, ShellKernl, StorageLike } from './contract';
  import AppletReview from './AppletReview.svelte';
  import Overlay from './Overlay.svelte';
  import { alreadyGranted } from './applet-link';
  import type { AppletLinkQueue } from './applet-link-queue.svelte';
  import type { WindowStore } from './window-store.svelte';

  interface Props {
    kernl: ShellKernl;
    request: Ask<'link.open-applet'>;
    storage: StorageLike;
    windows: WindowStore;
    queue: AppletLinkQueue;
  }
  const { kernl, request, storage, windows, queue }: Props = $props();
  const { source, target } = request.facts;
  const installed = alreadyGranted(kernl, target);
  const busy = $derived(queue.isBusy(request));

  function cancel(): void {
    queue.cancel();
  }

  function assertActive(): void {
    if (queue.model.current() !== request || request.signal?.aborted || !request.windowId || windows.get(request.windowId)?.status !== 'running') throw new Error('denied:link-withdrawn');
  }

  async function start(apply: () => void): Promise<void> {
    queue.setBusy(request, true);
    try {
      assertActive();
      await kernl.withGrantReview(target, async (review) => {
        apply();
        const existing = windows.windows.find((win) => review.canReuse(win.plan));
        if (existing) {
          windows.focus(existing.id);
          return;
        }
        const plan = await review.plan({ install: false });
        assertActive();
        if (plan.missingRequired.length) throw new Error('denied:required-permissions');
        await windows.openAndMount(plan);
        kernl.install(target);
      });
      queue.answer(request, true);
    } finally {
      queue.setBusy(request, false);
    }
  }
</script>

<Overlay title={request.defaultText.title} onclose={cancel} closeDisabled={busy}>
  <AppletReview {kernl} summary={target} {storage} action={installed ? 'Open' : 'Install and open'} onback={cancel} linked={{ source, start }} />
</Overlay>
