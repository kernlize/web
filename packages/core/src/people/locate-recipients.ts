import type { DmAdapter } from '@kehto/services';
import type { People } from './person.js';

/**
 * Let an applet name the people it writes to in any form of their identity.
 *
 * Every recipient of a send is read with `people.locate`, so hex, `npub` and
 * `nprofile` all work and the servers an `nprofile` names are asked for the
 * person's inboxes before the message is sealed. The backends still see hex.
 *
 * @param adapter - The messaging adapter to wrap.
 * @param people - The shell's finder.
 * @returns The adapter, with recipients read on the way in.
 * @throws `invalid:recipient` from `send` when a recipient is not an identity.
 * @example
 * ```ts
 * createDmService({ adapter: locateRecipients(messaging.composite(), kernl.people) });
 * ```
 */
export function locateRecipients(adapter: DmAdapter, people: Pick<People, 'locate'>): DmAdapter {
  return {
    ...adapter,
    async send(request) {
      const recipients = await Promise.all(request.recipients.map((recipient) => people.locate(recipient))).catch(() => {
        throw new Error('invalid:recipient');
      });
      return adapter.send({ ...request, recipients });
    },
  };
}
