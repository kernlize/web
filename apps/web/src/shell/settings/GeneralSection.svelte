<script lang="ts">
  // The shell's version is the core's: apps/web is a private workspace that stays at 0.0.0.
  import core from '../../../../../packages/core/package.json';
  import { toggleTheme } from '../../lib/theme';
  import type { BootMode } from '../contract';

  interface Props {
    mode: BootMode;
  }

  const { mode }: Props = $props();
</script>

<section class="shell-section" aria-labelledby="appearance-heading">
  <h3 id="appearance-heading">Appearance</h3>
  <div class="shell-actions">
    <button type="button" class="shell-button" onclick={toggleTheme}>Switch between light and dark</button>
  </div>
</section>
<section class="shell-section" aria-labelledby="about-heading">
  <h3 id="about-heading">About</h3>
  <dl class="shell-rows">
    <div><dt>Shell</dt><dd>kernl {core.version}</dd></div>
    <div><dt>Mode</dt><dd>{mode === 'preview' ? 'preview, offline' : 'live'}</dd></div>
    <div><dt>Source</dt><dd>Private during alpha. <a href="https://kernl.run/docs/decisions">Decisions</a> are public.</dd></div>
  </dl>
</section>
