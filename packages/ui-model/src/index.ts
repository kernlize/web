/**
 * Framework-free view models for a kernl shell's panels: the grants list, the ask queues, the guard
 * and traffic logs, notices and the unread count (#74). Streams are rxjs Observables.
 *
 * @packageDocumentation
 */

/**
 * The npm package name, shared by both registry builds.
 *
 * @example
 * ```ts
 * PACKAGE_NAME; // '@kernlize/ui-model'
 * ```
 */
export const PACKAGE_NAME = '@kernlize/ui-model';

export {
  GROUP_LABELS,
  UNKNOWN_DOMAIN_LABEL,
  WITHHELD_NOTE,
  contractName,
  domainLabel,
  formatBytes,
  grantGroups,
  grantsToApply,
  startingChoices,
  withheldByMessages,
  type GrantChoices,
  type GrantGroup,
  type GrantGroupId,
  type GrantInput,
  type GrantOp,
  type GrantApplet,
  type GrantRow,
  type GrantState,
} from './grants.js';

export { createAskQueue, createAskQueues, createAskRenderers, type AskQueue, type AskQueues, type AskQueuesByKind } from './asks.js';
export { NOTICE_LIFETIME_MS, createGuardLog, createNoticeStore, createTrafficLog, createUnreadCount, type GuardLog, type Notice, type NoticeStore, type TrafficFold, type TrafficLog, type TrafficMarks, type TrafficRow, type UnreadCount } from './logs.js';
