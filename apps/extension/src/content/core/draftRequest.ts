import { GENERATE_DRAFT_MESSAGE, type GenerateDraftResponse } from "./messaging.js";

/**
 * Ask the background to generate a reply draft. Resolves to an outcome; never
 * rejects. Shared by the Gmail compose button and the OWA reply button so the
 * channel handling (dead worker, closed port) exists exactly once.
 */
export function requestDraftFromBackground(
  accountEmail: string | null,
  providerThreadId: string,
  refKind: "thread" | "message" = "thread",
): Promise<GenerateDraftResponse> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: GENERATE_DRAFT_MESSAGE, accountEmail, providerThreadId, refKind },
        (response: GenerateDraftResponse | undefined) => {
          // A dead channel sets lastError and yields undefined; reading it here
          // also stops Chrome logging an unchecked-error warning onto the page.
          if (chrome.runtime.lastError || !response) {
            resolve({ ok: false, reason: "error" });
            return;
          }
          resolve(response);
        },
      );
    } catch {
      resolve({ ok: false, reason: "error" });
    }
  });
}
