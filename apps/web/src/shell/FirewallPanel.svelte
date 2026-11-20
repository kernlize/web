<script lang="ts">
  import type { FirewallRuleTarget, ShellKernl } from './contract';
  import { domainLabel } from './domains';
  import { actionWords, decisionWords, inheritWords, LINK_REQUEST, RULE_ACTIONS, ruleChoice, toRuleAction } from './firewall-words';
  import { observe } from './observe.svelte';
  import Overlay from './Overlay.svelte';
  import type { WindowStore } from './window-store.svelte';

  interface Props {
    kernl: ShellKernl;
    windows: WindowStore;
    onproblem: (title: string, body: string) => void;
    onclose: () => void;
  }

  const { kernl, windows, onproblem, onclose }: Props = $props();
  const { firewall } = kernl;
  const rules = observe(firewall.rules$, firewall.rules());
  const decisions = observe(firewall.decisions$, firewall.decisions());
  $effect(() => () => {
    rules.stop();
    decisions.stop();
  });

  /** The shell and its own wiring are not an applet's to be refused; links have their own row. */
  const NOT_LISTED = ['shell', 'link'];
  const domains = $derived(kernl.grants.availableDomains().filter((domain) => !NOT_LISTED.includes(domain)));
  const running = $derived(windows.windows.filter((win) => win.status !== 'revoked'));
  const given = $derived(decisions.value.filter((decision) => !decision.byRule));
  const titleOf = (hash: string): string => windows.windows.find((win) => win.plan.summary.identity.hash === hash)?.plan.summary.title ?? 'An applet that is not open';

  function set(target: FirewallRuleTarget, choice: string): void {
    try {
      firewall.setRule(target, toRuleAction(choice));
    } catch {
      onproblem('That rule could not be saved', 'The firewall kept the rules it had.');
    }
  }

  function clearAnswers(): void {
    if (!firewall.forgetAll()) onproblem('Stored answers could not be cleared', 'None is in force, but the stored copy is still there.');
  }

  function takeBack(id: string): void {
    if (!firewall.forget(id)) onproblem('That answer could not be removed', 'It is not in force, but the stored copy is still there.');
  }
</script>

{#snippet ruleSelect(id: string, target: FirewallRuleTarget, inherits: boolean)}
  <select {id} class="shell-select" value={ruleChoice(rules.value, target)} onchange={(event) => set(target, event.currentTarget.value)}>
    {#if inherits}<option value="inherit">{inheritWords(rules.value, target)}</option>{/if}
    {#each RULE_ACTIONS as action (action)}
      <option value={action}>{actionWords(action)}</option>
    {/each}
  </select>
{/snippet}

<Overlay title="Firewall" {onclose}>
  <p class="shell-muted lead">What applets may do without asking you.</p>

  <section class="shell-section">
    <h3>For every applet</h3>
    <ul class="shell-list rules" data-testid="firewall-rules">
      <li class="rule">
        <label for="rule-default">Everything you granted</label>
        {@render ruleSelect('rule-default', {}, false)}
      </li>
      <li class="rule">
        <label for="rule-link">Opening links</label>
        {@render ruleSelect('rule-link', { operation: LINK_REQUEST }, true)}
      </li>
    </ul>
    <details>
      <summary>By kind</summary>
      <ul class="shell-list rules">
        {#each domains as domain (domain)}
          <li class="rule">
            <label for="rule-domain-{domain}">{domainLabel(domain)}</label>
            {@render ruleSelect(`rule-domain-${domain}`, { domain }, true)}
          </li>
        {/each}
      </ul>
    </details>
    <div class="shell-actions">
      <button type="button" class="shell-button" onclick={() => firewall.restoreDefaults()}>Back to the starting rules</button>
    </div>
    <p class="shell-muted small">A stricter rule stops applets running under the old one.</p>
  </section>

  <section class="shell-section">
    <h3>For one applet</h3>
    {#if running.length}
      <ul class="shell-list rules" data-testid="firewall-applet-rules">
        {#each running as win (win.id)}
          {@const applet = win.plan.summary.manifest.catalogId}
          <li class="rule">
            <label for="rule-link-{win.id}"><span>{win.plan.summary.title}</span><small>Opening links</small></label>
            {@render ruleSelect(`rule-link-${win.id}`, { applet, operation: LINK_REQUEST }, true)}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="shell-muted">Open an applet to give it its own rule.</p>
    {/if}
  </section>

  <section class="shell-section">
    <h3>Answers you gave</h3>
    {#if given.length}
      <ul class="shell-list" data-testid="firewall-answers">
        {#each given as decision (decision.id)}
          <li class="shell-card answer">
            <p><strong>{titleOf(decision.hash)}</strong> · {decisionWords(decision)}</p>
            <button type="button" class="shell-button" onclick={() => takeBack(decision.id)}>Take back</button>
          </li>
        {/each}
      </ul>
      <p class="shell-muted small">Taking one back stops its applet.</p>
    {:else}
      <p class="shell-muted">None. Link answers are not kept.</p>
    {/if}
    <div class="shell-actions">
      <button type="button" class="shell-button" onclick={clearAnswers}>Clear all answers</button>
    </div>
  </section>
</Overlay>

<style>
  .lead {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
  }

  .rules {
    gap: 0;
  }

  .rule {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 13rem);
    gap: 0.5rem 1rem;
    align-items: center;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--line);
  }

  .rule label {
    display: grid;
    gap: 0.15rem;
  }

  .rule small,
  .small {
    color: var(--ink-muted);
    font-size: 0.8rem;
  }

  details {
    margin-top: 0.75rem;
  }

  summary {
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 0.85rem;
    color: var(--ink-muted);
  }

  .shell-actions {
    margin-top: 0.9rem;
  }

  .small {
    margin: 0.6rem 0 0;
  }

  .answer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .answer p {
    margin: 0;
    overflow-wrap: anywhere;
  }

  @media (max-width: 560px) {
    .rule {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
