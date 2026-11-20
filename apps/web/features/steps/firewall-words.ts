import { expect } from 'vitest';
import { Given, Then } from 'quickpickle';
import type { Firewall, FirewallChoice, FirewallDecision, FirewallRequest, FirewallRuleTarget, FirewallSummary } from '../../src/shell/contract.ts';
import { actionWords, choiceWords, decisionWords, firewallLines, firewallNote, firewallTitle, inheritWords, RULE_ACTIONS, ruleChoice, ruleInForce, toRuleAction } from '../../src/shell/firewall-words.ts';
import { namesProtocol } from '../../src/shell/vocabulary.ts';

type PermissionRules = ReturnType<Firewall['rules']>;

interface FirewallWordsWorld {
  firewallQuestion?: Pick<FirewallSummary, 'kind' | 'requests'>;
  firewallRules?: PermissionRules;
}

Given('a firewall question of kind {string} about {string}', (world: FirewallWordsWorld, kind: FirewallSummary['kind'], requests: string) => {
  world.firewallQuestion = { kind, requests: JSON.parse(requests) as FirewallRequest[] };
});

Then('the firewall question reads {string}', (world: FirewallWordsWorld, title: string) => {
  expect(firewallTitle(world.firewallQuestion as FirewallSummary)).toBe(title);
});

Then('its rows are {string}', (world: FirewallWordsWorld, rows: string) => {
  expect(firewallLines(world.firewallQuestion as FirewallSummary).map((line) => `${line.label}=${line.value}`).join('; ')).toBe(rows);
});

Then('the firewall notes for {string} each say why the person is asked', (_world: FirewallWordsWorld, kinds: string) => {
  const notes = kinds.split(',').map((kind) => firewallNote(kind as FirewallSummary['kind']));
  expect(new Set(notes).size).toBe(notes.length);
  for (const note of notes) expect(note.split(' ').length).toBeLessThanOrEqual(12);
});

Then('the firewall\'s words never name the protocol', () => {
  const kinds: FirewallSummary['kind'][] = ['link', 'access', 'request'];
  const choices: FirewallChoice[] = ['allow-once', 'allow-session', 'allow-always', 'deny'];
  const words = [
    ...kinds.flatMap((kind) => [firewallNote(kind), firewallTitle({ kind, requests: [{ kind: 'access', domain: 'relay', operation: 'access', target: 'relay' }] }), ...choices.map((choice) => choiceWords(choice, kind))]),
    ...RULE_ACTIONS.map(actionWords),
    decisionWords({ request: { kind: 'access', domain: 'relay', operation: 'access', target: 'relay' }, effect: 'allow', lifetime: 'always' }),
  ];
  for (const text of words) expect(namesProtocol(text), text).toBe(false);
});

Then('the {string} answer to a {string} question reads {string}', (_world: FirewallWordsWorld, choice: FirewallChoice, kind: FirewallSummary['kind'], words: string) => {
  expect(choiceWords(choice, kind)).toBe(words);
});

Then('the firewall answer {string} that is {string} for {string} reads {string}', (_world: FirewallWordsWorld, request: string, effect: FirewallDecision['effect'], lifetime: FirewallDecision['lifetime'], words: string) => {
  expect(decisionWords({ request: JSON.parse(request) as FirewallRequest, effect, lifetime })).toBe(words);
});

Given('firewall rules {string}', (world: FirewallWordsWorld, rules: string) => {
  world.firewallRules = { version: 1, default: 'ask', domains: {}, operations: {}, napplets: {}, ...(JSON.parse(rules) as Partial<PermissionRules>) };
});

Then('the rule set at {string} is {string}, what happens there is {string}, and leaving it unset reads {string}', (world: FirewallWordsWorld, target: string, own: string, inForce: string, inherit: string) => {
  const rules = world.firewallRules as PermissionRules;
  const at = JSON.parse(target) as FirewallRuleTarget;
  expect(ruleChoice(rules, at)).toBe(own);
  expect(ruleInForce(rules, at)).toBe(inForce);
  expect(inheritWords(rules, at)).toBe(inherit);
});

Then('the rule choices {string} become {string}', (_world: FirewallWordsWorld, choices: string, actions: string) => {
  expect(choices.split(',').map((choice) => toRuleAction(choice) ?? 'none').join(',')).toBe(actions);
});
