import { z } from "zod";

// Thread comments: server-enforced limits. Comments carry no AI cost, so these
// are plain validation bounds, not usage meters. The per-thread cap exists
// because the client loads the whole list into a panel; real triage discussion
// never approaches it.
export const MAX_COMMENT_LENGTH = 2000;
export const MAX_COMMENTS_PER_THREAD = 200;
export const MAX_MENTIONS_PER_COMMENT = 10;

// Mentions are structured: the client sends the user ids it confirmed via the
// @-picker, the server re-validates each against workspace membership. The body
// is pure display text and is never parsed for mentions server-side.
export const CreateThreadCommentSchema = z.object({
  body: z.string().trim().min(1).max(MAX_COMMENT_LENGTH),
  mentionUserIds: z.array(z.string().min(1)).max(MAX_MENTIONS_PER_COMMENT).default([]),
});
export type CreateThreadCommentInput = z.infer<typeof CreateThreadCommentSchema>;
