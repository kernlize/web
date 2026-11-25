/**
 * `@kernlize/modules/mailboxes`: the mailboxes module on its own, so a host that lists it bundles only what it needs (D-068).
 *
 * @packageDocumentation
 */
export {
  createAccountMailboxes,
  mailboxTags,
  mailboxesFromEvent,
  type AccountMailboxes,
  type AccountMailboxesOptions,
  type MailboxPool,
  type MailboxSigner,
  type MailboxState,
  type Mailboxes,
} from '../relays/mailboxes.js';
export { mailboxesModule } from '../modules/mailboxes.js';
