// The handshake between the injected reply entry points and the compose button.
//
// The Chiefy-style buttons (bottom reply bar, message header) do not generate
// anything themselves: they arm the thread and click Gmail's own Reply control.
// When the compose opens, the InboxSDK compose handler consumes the arm and
// auto-starts generation — so both paths converge on the one state machine in
// replyButton.ts, and there is never a second generation code path to drift.
//
// The panel arms the same way but brings the draft with it: it is showing the
// text already, so the compose inserts that rather than asking the API for a
// draft a second time. Without it the panel's own "mark as sent" can land
// first, leaving no PROPOSED draft to reuse — and the compose would generate a
// fresh one, spending a second draft from the monthly allowance and putting
// text in the reply that differs from what the panel shows.

/**
 * How long an arm stays valid. Long enough for Gmail to open the compose (an
 * animation plus a render), short enough that an abandoned click cannot
 * surprise-generate a draft minutes later on an unrelated reply.
 */
export const ARM_TTL_MS = 15_000;

type Armed = { threadId: string; at: number; html: string | null };

/** What a consumed arm asks the compose to do. */
export type ArmedReply = {
  /** Draft HTML to insert as-is. Null means "generate one". */
  html: string | null;
};

let armed: Armed | null = null;

/** Injectable clock for tests. */
let now = () => Date.now();
export function setArmedReplyClock(fn: () => number): void {
  now = fn;
}

/**
 * Called just before clicking Gmail's own Reply control. `html` is the draft to
 * insert when the caller already has one (the panel); omit it to have the
 * compose generate.
 */
export function armReply(threadId: string, html?: string): void {
  armed = { threadId, at: now(), html: html ?? null };
}

/**
 * Called by the compose handler for every compose that opens. Answers exactly
 * once per arm, and only for the armed thread: a compose the user opened by
 * hand for some other conversation must never auto-generate. A compose whose
 * thread id cannot be read (null) is accepted — the arm was set milliseconds ago
 * from the same conversation, and refusing would strand the click. Null means
 * this compose was not armed.
 */
export function consumeArmedReply(composeThreadId: string | null): ArmedReply | null {
  if (!armed) return null;
  if (now() - armed.at > ARM_TTL_MS) {
    armed = null;
    return null;
  }
  if (composeThreadId !== null && composeThreadId !== armed.threadId) return null;
  const { html } = armed;
  armed = null;
  return { html };
}
