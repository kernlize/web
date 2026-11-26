import type { AppletSummary, ShellKernl } from './contract';
import { GROUP_LABELS, grantGroups, grantsToApply, startingChoices, type GrantApplet, type GrantChoices, type GrantGroupId, type GrantGroup, type GrantInput, type GrantRow, type GrantState } from '@kernlize/ui-model';

/** A permission row that names every applet in the stack asking for it. */
export interface StackGrantRow extends GrantRow {
  readonly applets: readonly GrantApplet[];
}

export interface StackGrantGroup extends Omit<GrantGroup, 'rows'> {
  readonly rows: readonly StackGrantRow[];
}

/** One applet of a stack, ready for the grants screen: what it asks for, and what stands for it now. */
export interface StackGrantMember {
  readonly summary: AppletSummary;
  readonly input: GrantInput;
  readonly standing: GrantState;
}

/**
 * The grant inputs for a stack's applets: what each one asks for, read against what
 * this shell can offer, and what already stands for it.
 *
 * @param kernl - The shell, for its grant domains and records.
 * @param summaries - The resolved applets, in the order the stack listed them.
 * @returns One member per applet, in that order.
 * @example
 * ```ts
 * const members = stackMembers(kernl, found);
 * members[0]?.input.requires; // ['relay']
 * ```
 */
export function stackMembers(kernl: ShellKernl, summaries: readonly AppletSummary[]): StackGrantMember[] {
  const baseline = kernl.grants.baselineDomains();
  const available = kernl.grants.availableDomains();
  return summaries.map((summary) => {
    const record = kernl.grants.get(summary.identity);
    return {
      summary,
      input: { requires: summary.requires, optional: summary.optional, baseline, available, receives: summary.manifest.archetypes.length > 0 },
      standing: { granted: record?.domains ?? [], unsafe: record?.unsafe ?? [] },
    };
  });
}

/** Choices stay with each verified applet, even when several appear on one row. */
export type StackChoices = readonly GrantChoices[];

export function startingStackChoices(members: readonly StackGrantMember[]): StackChoices {
  return members.map(({ input, standing }) => startingChoices(input, standing, true));
}

interface MemberRow {
  readonly member: StackGrantMember;
  readonly row: GrantRow;
  readonly group: GrantGroupId;
}

/** A seal override is always a separate question from an ordinary grant for the same domain. */
function rowKey(group: GrantGroupId, domain: string): string {
  return `${group === 'unsafe' ? 'unsafe' : 'grant'}:${domain}`;
}

function memberRows(member: StackGrantMember, choice: GrantChoices): MemberRow[] {
  return grantGroups(member.input, choice).flatMap(({ id, rows }) => rows.map((row) => ({ row, member, group: id })));
}

export function stackGrantGroups(members: readonly StackGrantMember[], choices: StackChoices): StackGrantGroup[] {
  const byDomain = new Map<string, MemberRow[]>();
  for (const [i, member] of members.entries()) {
    for (const item of memberRows(member, choices[i]!)) {
      const key = rowKey(item.group, item.row.domain);
      const list = byDomain.get(key);
      if (list) list.push(item);
      else byDomain.set(key, [item]);
    }
  }
  const rows: Record<GrantGroupId, StackGrantRow[]> = { unsafe: [], required: [], optional: [], other: [] };
  for (const list of byDomain.values()) {
    const first = list.find(({ row }) => row.required) ?? list[0]!;
    const mixed = list.some(({ row }) => row.on !== first.row.on);
    rows[first.group].push({
      ...first.row, mixed, on: !mixed && first.row.on, locked: list.every(({ row }) => row.locked),
      applets: list.map(({ member, row }) => ({ title: member.summary.title, required: row.required })),
    });
  }
  return (['unsafe', 'required', 'optional', 'other'] as const).filter((id) => rows[id].length).map((id) => ({ id, label: GROUP_LABELS[id], rows: rows[id] }));
}

/** A switch changes only unlocked rows shown in that question, not grants or exceptions on other applets. */
export function changeStackGrant(members: readonly StackGrantMember[], choices: StackChoices, group: GrantGroupId, domain: string, on: boolean): StackChoices {
  return members.map((member, i) => {
    const choice = choices[i]!;
    if (!memberRows(member, choice).some((item) => rowKey(item.group, item.row.domain) === rowKey(group, domain) && !item.row.locked)) return choice;
    const field = group === 'unsafe' ? 'kept' : 'on';
    const next = new Set(choice[field]);
    if (on) next.add(domain);
    else next.delete(domain);
    return { ...choice, [field]: next };
  });
}

/**
 * Write the stack's grants: each applet gets the domains it asked for that are switched
 * on, and loses the ones it holds that are switched off. A domain another applet of the
 * stack needs is not written for an applet that never asked for it.
 *
 * @param kernl - The shell, for its grants.
 * @param members - The stack's applets.
 * @param choices - What the person confirmed.
 * @param remember - Whether to keep the grants for next time, or only for now.
 * @example
 * ```ts
 * applyStackGrants(kernl, members, choices, true);
 * ```
 */
export function applyStackGrants(kernl: ShellKernl, members: readonly StackGrantMember[], choices: StackChoices, remember: boolean): void {
  for (const [i, member] of members.entries()) {
    for (const op of grantsToApply(member.input, choices[i]!, member.standing)) {
      if (op.kind === 'allow') kernl.grants.allowDomain(member.summary.identity, op.domain, { remember, ...(op.unsafe === undefined ? {} : { unsafe: op.unsafe }) });
      else kernl.grants.revokeDomain(member.summary.identity, op.domain, { remember });
    }
  }
}

/** Hold this member's for-now record until its replacement has actually mounted (or failed). */
export async function openReviewedMember(kernl: ShellKernl, member: StackGrantMember, choice: GrantChoices, remember: boolean, open: Parameters<ShellKernl['withGrantReview']>[1]): Promise<void> {
  await kernl.withGrantReview(member.summary, async (start) => {
    applyStackGrants(kernl, [member], [choice], remember);
    await open(start);
  });
}
