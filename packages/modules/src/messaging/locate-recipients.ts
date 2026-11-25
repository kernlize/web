import type { DmAdapter, DmService } from '@kehto/services';
import type { People } from '../people/person.js';

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

/**
 * Read the recipients of a send before kehto's service sees them.
 *
 * Under the firewall kehto has every recipient approved before a message is
 * sent, and takes them as hex keys only, so an `npub` or `nprofile` would be
 * refused before {@link locateRecipients} could read it. This reads them
 * first; every other request passes straight through.
 *
 * @param service - kehto's `dm` service.
 * @param people - The shell's finder.
 * @returns The service, with a send's recipients read on the way in.
 * @example
 * ```ts
 * registry.dm = locateSendRecipients(createDmService({ adapter }), kernl.people);
 * ```
 */
export function locateSendRecipients(service: DmService, people: Pick<People, 'locate'>): DmService {
  return {
    ...service,
    handleMessage(windowId, message, send) {
      const { id, recipients } = message as { id?: string; recipients?: unknown };
      if (message.type !== 'dm.send' || !Array.isArray(recipients)) {
        service.handleMessage(windowId, message, send);
        return;
      }
      Promise.all(recipients.map((recipient: string) => people.locate(recipient))).then(
        (located) => service.handleMessage(windowId, { ...message, recipients: located } as typeof message, send),
        () => send({ type: 'dm.send.result', id: id ?? '', error: 'invalid:recipient' } as typeof message),
      );
    },
  };
}
