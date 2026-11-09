<script lang="ts">
  import type { ReplyAnswer, ReplyPrompt } from '@kernlize/messaging';
  import Overlay from './Overlay.svelte';
  import { alwaysMeans, peerName, rememberChoices, replyQuestion } from './reply-words';

  interface Props {
    prompt: ReplyPrompt;
    onanswer: (answer: ReplyAnswer | undefined) => void;
  }

  const { prompt, onanswer }: Props = $props();
  const name = $derived(peerName(prompt.peer));
  // Theirs is the suggestion: it is the one the other person is known to read.
  let use = $state<ReplyAnswer['use']>('theirs');
  let remember = $state<ReplyAnswer['remember']>('once');

  const options = $derived([
    { id: 'theirs' as const, provider: prompt.theirs, note: `the way ${name} wrote to you` },
    { id: 'mine' as const, provider: prompt.mine, note: 'first in your order' },
  ]);
</script>

<Overlay title="How should this reply travel?" onclose={() => onanswer(undefined)}>
  <form class="reply" onsubmit={(event) => (event.preventDefault(), onanswer({ use, remember }))}>
    <p class="question">{replyQuestion(prompt)}</p>
    <fieldset class="group">
      <legend class="shell-muted">Send it through</legend>
      {#each options as option (option.id)}
        <label class="shell-card option" class:active={use === option.id}>
          <input type="radio" name="reply-use" value={option.id} bind:group={use} />
          <span class="name">{option.provider.name}</span>
          <span class="shell-badge" class:on={option.id === 'theirs'}>{option.note}</span>
          <small>{option.provider.description}</small>
        </label>
      {/each}
    </fieldset>
    <fieldset class="group">
      <legend class="shell-muted">Do this</legend>
      {#each rememberChoices(prompt) as choice (choice.id)}
        <label class="keep">
          <input type="radio" name="reply-remember" value={choice.id} bind:group={remember} />
          <span>{choice.label}</span>
        </label>
      {/each}
      {#if remember === 'always'}<p class="shell-muted small" role="status">{alwaysMeans(use)}</p>{/if}
    </fieldset>
    <div class="shell-actions">
      <button type="submit" class="shell-button primary">Send</button>
      <button type="button" class="shell-button quiet" onclick={() => onanswer(undefined)}>Do not send</button>
    </div>
    <p class="shell-muted small">You can change this under Settings, Messages.</p>
  </form>
</Overlay>

<style>
  .reply {
    display: grid;
    gap: 0.9rem;
  }

  .question {
    margin: 0;
    font-size: 1.02rem;
  }

  .group {
    border: 0;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.5rem;
  }

  .group legend {
    margin-bottom: 0.4rem;
    font-size: 0.85rem;
  }

  .option {
    grid-template-columns: auto 1fr auto;
    column-gap: 0.6rem;
    align-items: center;
    cursor: pointer;
  }

  .option.active {
    border-color: var(--accent);
  }

  .option small {
    grid-column: 2 / -1;
    color: var(--ink-muted);
    font-size: 0.8rem;
  }

  .keep {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.92rem;
    cursor: pointer;
  }

  .small {
    font-size: 0.82rem;
    margin: 0;
  }
</style>
