<script lang="ts">
  import { untrack } from 'svelte';
  import type { BootMode, ShellKernl } from '../contract';
  import type { ShellDownloads } from '../downloads';
  import DownloadsSection from './DownloadsSection.svelte';
  import GeneralSection from './GeneralSection.svelte';
  import MediaSection from './MediaSection.svelte';
  import MeetingSettings from './MeetingSettings.svelte';
  import MessagingSettings from './MessagingSettings.svelte';
  import { SETTINGS_SECTIONS, settingsPanelId, settingsSectionForKey, settingsTabId, type SettingsSectionId, type TabOrientation } from './sections';
  import ServersSection from './ServersSection.svelte';

  interface Props {
    kernl: ShellKernl;
    mode: BootMode;
    downloads: ShellDownloads;
    section: SettingsSectionId;
    /** Counts the times Settings was asked for; each one moves the keyboard to the chosen tab. */
    opened: number;
    onsection: (section: SettingsSectionId) => void;
  }

  const { kernl, mode, downloads, section, opened, onsection }: Props = $props();

  let tabs = $state<HTMLElement | null>(null);
  let content = $state<HTMLElement | null>(null);
  let orientation = $state<TabOrientation>('vertical');
  // A section is drawn when first chosen and kept until the window closes, so a list half edited survives a look at another tab.
  let drawn = $state.raw<readonly SettingsSectionId[]>([]);

  const tabOf = (id: SettingsSectionId): HTMLElement | null => document.getElementById(settingsTabId(id));

  $effect(() => {
    const chosen = section;
    untrack(() => {
      if (!drawn.includes(chosen)) drawn = [...drawn, chosen];
    });
    content?.scrollTo({ top: 0 });
  });

  // The menu that opened Settings closes under the keyboard; without this, focus would fall to the page and Escape would go unheard.
  $effect(() => {
    void opened;
    untrack(() => tabOf(section)?.focus());
  });

  // The stylesheet decides when the tabs become a row; the list is asked which way it runs, so the two cannot disagree.
  $effect(() => {
    const list = tabs;
    if (!list) return;
    const read = (): void => {
      orientation = getComputedStyle(list).flexDirection === 'row' ? 'horizontal' : 'vertical';
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(list);
    return () => observer.disconnect();
  });

  function onTabKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = settingsSectionForKey(section, event.key, orientation);
    if (!next) return;
    event.preventDefault();
    onsection(next);
    tabOf(next)?.focus();
  }
</script>

<div class="settings">
  <div class="frame">
    <div class="tabs" role="tablist" aria-label="Settings sections" aria-orientation={orientation} bind:this={tabs}>
      {#each SETTINGS_SECTIONS as item (item.id)}
        <button
          type="button"
          role="tab"
          id={settingsTabId(item.id)}
          aria-selected={item.id === section}
          aria-controls={settingsPanelId(item.id)}
          tabindex={item.id === section ? 0 : -1}
          onclick={() => onsection(item.id)}
          onkeydown={onTabKeydown}
        >{item.label}</button>
      {/each}
    </div>
    <div class="content" bind:this={content}>
      {#each SETTINGS_SECTIONS as item (item.id)}
        <div class="pane" role="tabpanel" id={settingsPanelId(item.id)} aria-labelledby={settingsTabId(item.id)} hidden={item.id !== section}>
          {#if item.id === section || drawn.includes(item.id)}
            {#if item.id === 'general'}
              <GeneralSection {mode} />
            {:else if item.id === 'servers'}
              <ServersSection {kernl} {mode} />
            {:else if item.id === 'messages'}
              <MessagingSettings {kernl} />
            {:else if item.id === 'connections'}
              <MeetingSettings {kernl} />
            {:else if item.id === 'media'}
              <MediaSection {kernl} {mode} />
            {:else}
              <DownloadsSection {kernl} {mode} {downloads} />
            {/if}
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  /* Fills the window's body, whose own padding and scrolling are for a single column: the tabs stay put and the section scrolls beside them. */
  .settings {
    position: absolute;
    inset: 0;
    container: settings / inline-size;
    border-radius: inherit;
    overflow: hidden;
  }

  .frame {
    height: 100%;
    display: grid;
    grid-template-columns: 11rem minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }

  .tabs {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.75rem 0.5rem;
    background: var(--bg);
    border-right: 1px solid var(--line);
    overflow: auto;
  }

  .tabs button {
    flex: none;
    font: inherit;
    font-size: 0.9rem;
    text-align: left;
    color: var(--ink-muted);
    background: transparent;
    border: 0;
    border-radius: 8px;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    white-space: nowrap;
  }

  .tabs button:hover {
    color: var(--ink);
  }

  .tabs button[aria-selected='true'] {
    color: var(--ink);
    background: var(--accent-soft);
    font-weight: 600;
  }

  .tabs button:focus-visible {
    outline-offset: -2px;
    border-radius: 8px;
  }

  .content {
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 1rem 1.25rem 1.5rem;
    container-type: inline-size;
  }

  .pane {
    max-width: 52rem;
  }

  .pane :global(.shell-section + .shell-section) {
    margin-top: 1.5rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--line);
  }

  /* A narrow window, however wide the page is: the tabs run across the top, onto a second line when they do not fit. */
  @container settings (max-width: 34rem) {
    .frame {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr);
    }

    .tabs {
      flex-direction: row;
      flex-wrap: wrap;
      gap: 0.1rem;
      padding: 0.4rem 0.35rem;
      border-right: 0;
      border-bottom: 1px solid var(--line);
      scrollbar-width: none;
    }

    .tabs button {
      padding: 0.5rem 0.35rem;
      font-size: 0.82rem;
    }

    .content {
      padding: 0.9rem 1rem 1.5rem;
    }
  }
</style>
