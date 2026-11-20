import { expect } from 'vitest';
import { Given, Then } from 'quickpickle';
import type { FirewallChoice, FirewallRuleTarget } from '../../src/shell/contract.ts';
import { preview, previewKernl, type PreviewWorld } from './kernl.ts';

Given('a preview kernl whose host cannot ask firewall questions', (world: PreviewWorld) => previewKernl(world, false, true, false));

Given('the preview kernl user will answer firewall questions with {string}', (world: PreviewWorld, answer: FirewallChoice | 'dismiss') => {
  preview(world).firewallAnswer = answer;
});

Given('the preview kernl firewall rule for {string} is {string}', (world: PreviewWorld, target: string, action: string) => {
  const { firewall } = preview(world).kernl;
  if (action === 'restored') firewall.restoreDefaults();
  else firewall.setRule(JSON.parse(target) as FirewallRuleTarget, action === 'removed' ? undefined : (action as 'allow' | 'ask' | 'deny'));
});

Then('the preview kernl user was asked {int} firewall question(s)', (world: PreviewWorld, count: number) => {
  expect(preview(world).firewallQuestions).toHaveLength(count);
});

Then('the preview kernl firewall question is a link to {string} from {string} that can be opened once or not', (world: PreviewWorld, url: string, title: string) => {
  const question = preview(world).firewallQuestions.at(-1);
  expect(question?.summary).toMatchObject({ kind: 'link', applet: { title }, requests: [{ kind: 'resource', domain: 'link', operation: 'link.open', target: url }], choices: ['allow-once', 'deny'] });
  expect(question?.signal.aborted).toBe(false);
  const onAbort = (): void => undefined;
  expect(() => {
    question?.signal.addEventListener('abort', onAbort);
    question?.signal.removeEventListener('abort', onAbort);
  }).not.toThrow();
});

Then('the preview kernl host opened {string} as already approved', (world: PreviewWorld, url: string) => {
  expect(preview(world).approvedLinks).toEqual([url]);
});

Then('the preview kernl firewall keeps its rules, holds no answers and has none to take back', (world: PreviewWorld) => {
  const { firewall } = preview(world).kernl;
  const seen: unknown[] = [];
  firewall.rules$.subscribe((rules) => seen.push(rules)).unsubscribe();
  expect(seen).toEqual([firewall.rules()]);
  expect(firewall.rules().operations).toEqual({ 'link.open': 'ask' });
  const told: unknown[] = [];
  firewall.decisions$.subscribe((decisions) => told.push(decisions)).unsubscribe();
  expect([firewall.decisions(), ...told]).toEqual([[], []]);
  expect([firewall.forget('any'), firewall.forgetAll(), firewall.available]).toEqual([true, true, true]);
});
