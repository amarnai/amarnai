import { Prisma } from "@prisma/client";

/**
 * The "eligible threads" predicate for taxonomy generation.
 *
 * A thread is eligible (carries usable taxonomy signal) only when it is NOT:
 *   - automated/bulk (notifications, newsletters, service mail),
 *   - in Trash (always excluded),
 *   - Spam (unless the workspace opted in),
 *   - Promotions (unless the workspace opted in),
 *   - from a blacklisted sender.
 *
 * This mirrors the user-facing `isThreadExcluded` rules PLUS the `isAutomated`
 * exclusion. It is the SINGLE source for both the aggregation query and the
 * delta/sufficiency count, so the two can never diverge. `triageStatus` is
 * intentionally not a factor — a thread carries signal regardless of whether it
 * was sorted, quota-blocked, or unrouted.
 *
 * `isAutomated` is read from the column only and never recomputed here.
 */
export function eligibleThreadWhere(
  workspaceId: string,
  settings: {
    includeSpam: boolean;
    includePromotions: boolean;
    blacklistedSenderEmails: string[];
  },
): Prisma.EmailThreadWhereInput {
  const where: Prisma.EmailThreadWhereInput = {
    workspaceId,
    isAutomated: false,
    gmailIsTrash: false,
  };

  if (!settings.includeSpam) where.gmailIsSpam = false;
  if (!settings.includePromotions) where.gmailIsPromotions = false;

  // Blacklist lives on message senders: exclude a thread if ANY of its messages
  // is from a blacklisted sender. Stored lowercased in settings; match against
  // lowercased sender emails.
  const blacklist = settings.blacklistedSenderEmails;
  if (blacklist.length > 0) {
    // Case-insensitive match (settings are stored lowercased). Prisma's `in`
    // does not support `mode`, so OR equality filters are used instead.
    where.messages = {
      none: {
        OR: blacklist.map((email) => ({
          senderEmail: { equals: email, mode: "insensitive" as const },
        })),
      },
    };
  }

  return where;
}
