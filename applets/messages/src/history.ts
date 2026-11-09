import type { Lane } from './pacer.js';
import { readMessages } from './shell.js';
import { toChatMessage, type ChatMessage } from './threads.js';

const PAGE_SIZE = 100;
const PAGE_LIMIT = 500;

/**
 * Every message of one shell conversation, following the cursor to the end.
 * A repeated cursor or the page cap stops a shell that never ends the list.
 * `lane` is asked before each page, so a thread being read in the background
 * speeds up as soon as someone opens it.
 */
export async function readHistory(conversationId: string, lane: () => Lane): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < PAGE_LIMIT; page += 1) {
    const query = { conversationId, limit: PAGE_SIZE };
    const result = await readMessages(cursor === undefined ? query : { ...query, cursor }, lane());
    messages.push(...result.messages.map(toChatMessage));
    if (!result.cursor || cursors.has(result.cursor)) break;
    cursors.add(result.cursor);
    cursor = result.cursor;
  }
  return messages;
}
