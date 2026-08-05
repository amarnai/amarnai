import type { MemberItem } from "./types.js";

/** A `@label` occurrence in composer text that resolves to a workspace member. */
export interface MentionSegment {
  /** Index of the `@`. */
  start: number;
  /** Index one past the label's last character. */
  end: number;
  userId: string;
}

/**
 * Find every valid mention in composer text: `@` + a member's display label
 * (name, or email when there is no name), case-insensitive, bounded by
 * whitespace/punctuation on both sides so partial words and email addresses
 * never match. Longest label wins at each position ("@Alice Smith" beats
 * "@Alice").
 *
 * This is the single source of which tokens count as tags: the composer's
 * highlight layer colors exactly these segments, and submission derives its
 * mentionUserIds from them — so a tag reads as valid if and only if it will
 * notify. The server re-validates every id against workspace membership.
 */
export function findMentionSegments(
  text: string,
  members: MemberItem[] | null,
): MentionSegment[] {
  if (!members || members.length === 0) return [];
  const labels = members
    .map((m) => ({ userId: m.userId, label: `@${(m.name ?? m.email).toLowerCase()}` }))
    .sort((a, b) => b.label.length - a.label.length);
  const lower = text.toLowerCase();

  const segments: MentionSegment[] = [];
  let i = 0;
  while (i < text.length) {
    const at = lower.indexOf("@", i);
    if (at === -1) break;
    const before = at === 0 ? null : text[at - 1]!;
    if (before !== null && !/[\s([{'"]/.test(before)) {
      // Mid-word @ (an email address, most likely) is never a tag; whitespace
      // and opening punctuation are the only things allowed to precede one.
      i = at + 1;
      continue;
    }
    let advancedTo = at + 1;
    for (const { userId, label } of labels) {
      if (lower.startsWith(label, at)) {
        const after = text[at + label.length];
        if (after === undefined || /[\s.,;:!?)]/.test(after)) {
          segments.push({ start: at, end: at + label.length, userId });
          advancedTo = at + label.length;
          break;
        }
      }
    }
    i = advancedTo;
  }
  return segments;
}
