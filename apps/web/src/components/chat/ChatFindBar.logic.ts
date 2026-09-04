import type { MessagesTimelineRow } from "./MessagesTimeline.logic";

export interface ChatFindMatch {
  readonly rowId: string;
  readonly rowIndex: number;
  readonly occurrence: number;
}

export function chatFindMatchKey(match: ChatFindMatch): string {
  return `${match.rowId}:${match.occurrence}`;
}

export function chatFindSearchableText(row: MessagesTimelineRow): string | null {
  if (row.kind !== "message") return null;
  const text = row.message.text;
  return typeof text === "string" && text.length > 0 ? text : null;
}

export function countChatFindOccurrences(text: string, query: string): number {
  if (query.length === 0) return 0;
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  let count = 0;
  for (
    let index = haystack.indexOf(needle);
    index !== -1;
    index = haystack.indexOf(needle, index + needle.length)
  ) {
    count += 1;
  }
  return count;
}

export function deriveChatFindMatches(
  rows: ReadonlyArray<MessagesTimelineRow>,
  query: string,
): ChatFindMatch[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const matches: ChatFindMatch[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row) continue;
    const text = chatFindSearchableText(row);
    if (text === null) continue;
    const count = countChatFindOccurrences(text, trimmed);
    for (let occurrence = 0; occurrence < count; occurrence += 1) {
      matches.push({ rowId: row.id, rowIndex, occurrence });
    }
  }
  return matches;
}

export function resolveChatFindStartIndex(
  matches: ReadonlyArray<ChatFindMatch>,
  fromRowIndex: number | null,
): number {
  if (fromRowIndex === null) return 0;
  const index = matches.findIndex((match) => match.rowIndex >= fromRowIndex);
  return index === -1 ? 0 : index;
}

export function stepChatFindIndex(index: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return 0;
  return (((index + direction) % count) + count) % count;
}

export function resolveChatFindActiveIndex(
  matches: ReadonlyArray<ChatFindMatch>,
  previousIndex: number,
  previousMatch: ChatFindMatch | null,
): number {
  if (matches.length === 0) return 0;
  if (previousMatch !== null) {
    const key = chatFindMatchKey(previousMatch);
    const sameIndex = matches.findIndex((match) => chatFindMatchKey(match) === key);
    if (sameIndex !== -1) return sameIndex;
  }
  return Math.min(Math.max(previousIndex, 0), matches.length - 1);
}
