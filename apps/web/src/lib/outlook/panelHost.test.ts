import { describe, it, expect, vi } from "vitest";
import { ITEM_CHANGED, type OfficeLike } from "./officeHost";
import { createOutlookPanelHost } from "./panelHost";

// The Outlook side of the PanelHost seam. What matters here is only the
// translation: Outlook's vocabulary and Office.js's shapes on one side, the
// shared panel's contract on the other.

type Handler = () => void;

function makeOffice(conversationId: string | null = "AAQkAD+abc") {
  const handlers = new Map<string, Handler>();
  const displayed: Array<{ htmlBody: string }> = [];
  const office = {
    onReady: vi.fn(),
    EventType: { ItemChanged: ITEM_CHANGED },
    context: {
      mailbox: {
        item: conversationId
          ? {
              conversationId,
              displayReplyForm: (reply: { htmlBody: string }) => displayed.push(reply),
            }
          : null,
        userProfile: { emailAddress: "ada@contoso.com" },
        addHandlerAsync: (type: string, handler: Handler) => handlers.set(type, handler),
        removeHandlerAsync: (type: string) => handlers.delete(type),
      },
    },
  } as unknown as OfficeLike;
  return { office, displayed };
}

function makeHost(office: OfficeLike, onRequestSignIn = vi.fn()) {
  return createOutlookPanelHost({
    office,
    apiBaseUrl: "https://api.test",
    onRequestSignIn,
  });
}

describe("createOutlookPanelHost", () => {
  // Outlook calls it a conversationId, Amarnai calls it a providerThreadId, and
  // they are the same value. Renaming happens once, in the host.
  it("reports the conversation id as a providerThreadId", () => {
    const { office } = makeOffice();
    const listener = vi.fn();
    makeHost(office).onThreadContext(listener);
    expect(listener).toHaveBeenCalledWith({
      providerThreadId: "AAQkAD+abc",
      accountEmail: "ada@contoso.com",
    });
  });

  // The EWS/Graph alphabet difference is normalized server-side so this pane and
  // the Gmail content script cannot drift; the host must not pre-mangle it.
  it("passes the EWS-flavored id through untouched", () => {
    const { office } = makeOffice("AAQkAD/g+abc=");
    const listener = vi.fn();
    makeHost(office).onThreadContext(listener);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ providerThreadId: "AAQkAD/g+abc=" }),
    );
  });

  it("reports null when no conversation is open", () => {
    const { office } = makeOffice(null);
    const listener = vi.fn();
    makeHost(office).onThreadContext(listener);
    expect(listener).toHaveBeenCalledWith(null);
  });

  it("hands an inserted draft to Outlook's own reply form", async () => {
    const { office, displayed } = makeOffice();
    await expect(makeHost(office).insertDraft("<p>Thursday works.</p>")).resolves.toBe(true);
    expect(displayed).toEqual([{ htmlBody: "<p>Thursday works.</p>" }]);
  });

  // The panel keeps the draft on screen with copy still available rather than
  // claiming an insertion that did not happen.
  it("resolves false when there is no item to reply to", async () => {
    const { office } = makeOffice(null);
    await expect(makeHost(office).insertDraft("<p>hi</p>")).resolves.toBe(false);
  });

  // Outlook desktop is a WebView with nowhere useful for window.open to land, so
  // the panel must not render links out here.
  it("declares no external-link capability", () => {
    const { office } = makeOffice();
    expect(makeHost(office).capabilities.openExternal).toBe(false);
  });

  // A task pane that is not on screen is not running: Outlook tears the document
  // down rather than hiding it, so the panel is always visible while it exists.
  it("reports the pane as visible", () => {
    const { office } = makeOffice();
    const listener = vi.fn();
    makeHost(office).onVisibilityChanged(listener);
    expect(listener).toHaveBeenCalledWith(true);
  });

  it("routes a sign-in request back to the pane", () => {
    const { office } = makeOffice();
    const onRequestSignIn = vi.fn();
    makeHost(office, onRequestSignIn).requestSignIn();
    expect(onRequestSignIn).toHaveBeenCalled();
  });
});
