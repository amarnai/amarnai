// The handshake between the injected reply entry points and the compose button.
//
// The Chiefy-style buttons (bottom reply bar, message header) do not generate
// anything themselves: they arm the thread and click Gmail's own Reply control.
// When the compose opens, the InboxSDK compose handler consumes the arm and
// auto-starts generation — so both paths converge on the one state machine in
// replyButton.ts, and there is never a second generation code path to drift.

/**
 * How long an arm stays valid. Long enough for Gmail to open the compose (an
 * animation plus a render), short enough that an abandoned click cannot
 * surprise-generate a draft minutes later on an unrelated reply.
 */
export const ARM_TTL_MS = 15_000;

type Armed = { threadId: string; at: number };

let armed: Armed | null = null;

/** Injectable clock for tests. */
let now = () => Date.now();
export function setArmedReplyClock(fn: () => number): void {
  now = fn;
}

/** Called by an entry-point button just before it clicks Gmail's own Reply. */
export function armReply(threadId: string): void {
  armed = { threadId, at: now() };
}

/**
 * Called by the compose handler for every compose that opens. True exactly once
 * per arm, and only for the armed thread: a compose the user opened by hand for
 * some other conversation must never auto-generate. A compose whose thread id
 * cannot be read (null) is accepted — the arm was set milliseconds ago from the
 * same conversation, and refusing would strand the click.
 */
export function consumeArmedReply(composeThreadId: string | null): boolean {
  if (!armed) return false;
  if (now() - armed.at > ARM_TTL_MS) {
    armed = null;
    return false;
  }
  if (composeThreadId !== null && composeThreadId !== armed.threadId) return false;
  armed = null;
  return true;
}
