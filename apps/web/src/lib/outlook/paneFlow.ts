import {
  InjectionDisabledError,
  resolveWorkspaceIdForMailbox,
  type ApiClient,
} from "@amarnai/api-client";
import { draftBodyToHtml } from "@amarnai/core/drafts";
import { insertReplyDraft, type OfficeLike, type OutlookContext } from "./officeHost";

// What happens when the user asks for a draft, with every branch the API can
// return mapped to something the pane can actually say. Deliberately free of
// React so the whole flow is testable against a fake client and a fake Office.

export type PaneOutcome =
  | { kind: "inserted" }
  | { kind: "quota"; used: number; limit: number; resetsAt: string }
  | { kind: "notSorted" }
  | { kind: "noThread" }
  | { kind: "noWorkspace" }
  | { kind: "injectionDisabled" }
  | { kind: "error" };

// A 202 means a generation for this thread is already in flight, most often the
// user's own: the ribbon deep link auto-starts, so a second click (or the web
// app open on the same thread) lands here routinely. Wait for that generation
// rather than reporting a failure or starting a second one, which would
// double-charge the user's quota. Same intervals as the extension's
// draftHandler, deliberately: one behaviour across both Outlook surfaces.
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 30_000;

const realSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Injected by tests so the polling loop does not spend real seconds. */
export type PaneFlowClock = {
  sleep: (ms: number) => Promise<unknown>;
  now: () => number;
};

/**
 * Generate a reply for the open conversation and hand it to Outlook's own reply
 * form. Never throws: every failure is an outcome the pane renders.
 *
 * The conversation id goes to the server as Outlook gave it to us; the server
 * normalizes the EWS/Graph alphabet difference (normalizeProviderThreadId) so
 * this pane and the Gmail content script cannot drift apart on id handling.
 */
export async function generateAndInsertReply(
  api: ApiClient,
  office: OfficeLike,
  context: OutlookContext,
  clock: PaneFlowClock = { sleep: realSleep, now: () => Date.now() },
): Promise<PaneOutcome> {
  let workspaceId: string | null;
  try {
    workspaceId = await resolveWorkspaceIdForMailbox(api, context.accountEmail);
  } catch {
    return { kind: "error" };
  }
  if (!workspaceId) return { kind: "noWorkspace" };

  const deadline = clock.now() + POLL_TIMEOUT_MS;
  for (;;) {
    let result;
    try {
      result = await api.generateDraftByProviderThread(workspaceId, context.conversationId);
    } catch (e) {
      // A refusal, not a failure: the workspace turned the reply button off.
      if (e instanceof InjectionDisabledError) return { kind: "injectionDisabled" };
      const message = e instanceof Error ? e.message : "";
      return { kind: /not found/i.test(message) ? "noThread" : "error" };
    }

    if ("quotaExceeded" in result) {
      return {
        kind: "quota",
        used: result.used,
        limit: result.limit,
        resetsAt: result.resetsAt,
      };
    }
    if ("notClassified" in result) return { kind: "notSorted" };

    if ("draft" in result) {
      const html = draftBodyToHtml(result.draft.body);
      if (html === "") return { kind: "error" };
      try {
        insertReplyDraft(office, html);
      } catch {
        return { kind: "error" };
      }
      return { kind: "inserted" };
    }

    // 202: wait for the in-flight generation. Giving up past the deadline is an
    // error rather than a distinct outcome — by then something really is stuck.
    if (clock.now() + POLL_INTERVAL_MS > deadline) return { kind: "error" };
    await clock.sleep(POLL_INTERVAL_MS);
  }
}
