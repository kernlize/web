import { createFirewallRules, toAskChannel } from '@kernlize/core';
import { of } from 'rxjs';
import type { AppletSummary, Firewall, FirewallSummary, KernlHost } from './contract';
import { LINK_REQUEST } from './firewall-words';

/** The preview's firewall: the live shell's rules over the preview's storage, and the one question it can put. */
export interface PreviewFirewall {
  readonly firewall: Firewall;
  /**
   * Put an applet's link to the rules, as the live shell does: open it, refuse it, or ask the
   * person first. Resolves the words the applet is told.
   */
  openLink(summary: AppletSummary, url: string): Promise<{ readonly ok: boolean; readonly text: string }>;
}

const OPENED = { ok: true, text: 'The link was opened.' } as const;
const NOT_OPENED = { ok: false, text: 'You did not open the link.' } as const;
const REFUSED = { ok: false, text: 'Refused: a firewall rule refuses links.' } as const;

/** A question the preview never withdraws: nothing here times out or loses its window mid-question. */
const NEVER_WITHDRAWN = { aborted: false, addEventListener: () => undefined, removeEventListener: () => undefined } as const;

/**
 * The firewall as the offline preview has it. The rules are the live shell's own, kept in the
 * preview's storage, so the panel behaves the same; nothing runs for real here, so no answer is
 * ever in force and there is none to take back.
 */
export function createPreviewFirewall(host: Pick<KernlHost, 'storage' | 'asks' | 'presentApproval' | 'openLink'>): PreviewFirewall {
  const rules = createFirewallRules(host.storage);
  const firewall: Firewall = {
    rules: () => rules.current(),
    rules$: rules.rules$,
    setRule: (target, action) => rules.set(target, action),
    restoreDefaults: () => rules.restoreDefaults(),
    available: true,
    decisions: () => [],
    decisions$: of([]),
    forget: () => true,
    forgetAll: () => true,
  };
  return {
    firewall,
    async openLink(summary, url) {
      const { catalogId } = summary.manifest;
      const principal = { kind: 'verified', manifestKey: catalogId, artifactHash: summary.identity.hash } as const;
      const action = rules.decide({ principal }, [{ category: 'resource', domain: 'link', operation: LINK_REQUEST, scope: { kind: 'exact', value: url } }]);
      if (action === 'deny') return REFUSED;
      const open = (): typeof OPENED => {
        host.openLink(url, { approved: true });
        return OPENED;
      };
      if (action === 'allow') return open();
      const asks = toAskChannel(host);
      // A host with nobody to ask refuses, as the live shell does.
      if (!asks.has('firewall.approve')) return NOT_OPENED;
      const question: FirewallSummary = {
        kind: 'link',
        applet: { title: summary.title, catalogId, identity: summary.identity },
        requests: [{ kind: 'resource', domain: 'link', operation: LINK_REQUEST, target: url }],
        choices: ['allow-once', 'deny'],
      };
      const choice = await asks.ask({ kind: 'firewall.approve', applet: summary.identity, facts: question, defaultText: { title: 'Open a link outside kernl' }, signal: NEVER_WITHDRAWN });
      return choice === 'allow-once' ? open() : NOT_OPENED;
    },
  };
}
