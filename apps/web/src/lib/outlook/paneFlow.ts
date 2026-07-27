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
): Promise<PaneOutcome> {
  let workspaceId: string | null;
  try {
    workspaceId = await resolveWorkspaceIdForMailbox(api, context.accountEmail);
  } catch {
    return { kind: "error" };
  }
  if (!workspaceId) return { kind: "noWorkspace" };

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
  // 202: another request is already generating this draft. The pane has no
  // polling loop — the user can press the button again in a moment.
  if (!("draft" in result)) return { kind: "error" };

  const html = draftBodyToHtml(result.draft.body);
  if (html === "") return { kind: "error" };

  try {
    insertReplyDraft(office, html);
  } catch {
    return { kind: "error" };
  }
  return { kind: "inserted" };
}
