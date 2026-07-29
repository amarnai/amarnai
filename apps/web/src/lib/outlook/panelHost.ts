import type { PanelHost, PanelThreadContext } from "@amarnai/panel";
import { paneTokenStore } from "./paneTokenStore";
import { insertReplyDraft, subscribeOutlookContext, type OfficeLike } from "./officeHost";

// The panel's view of Outlook, from inside the task pane.
//
// The Gmail side of this seam is a postMessage link to a content script; here
// everything is a direct Office.js call, because the pane IS the add-in rather
// than a frame inside someone else's script. What the two have in common is only
// what PanelHost declares — which is the point of the interface.

export type OutlookPanelHostDeps = {
  office: OfficeLike;
  apiBaseUrl: string;
  /** Called when the panel wants a sign-in surface; the pane renders its form. */
  onRequestSignIn: () => void;
};

export function createOutlookPanelHost({
  office,
  apiBaseUrl,
  onRequestSignIn,
}: OutlookPanelHostDeps): PanelHost {
  return {
    capabilities: {
      insertDraft: true,
      signIn: true,
      // Outlook desktop is a WebView, not a browser tab: window.open lands
      // somewhere unhelpful or nowhere at all, and there is no reliable way to
      // tell desktop from OWA at runtime. Office.js has displayNewMessageForm
      // and friends but nothing for "open this URL", so the panel simply does
      // not offer links out here.
      openExternal: false,
    },

    apiBaseUrl,
    tokenStore: paneTokenStore,

    onThreadContext(listener) {
      // Outlook calls it a conversationId, Amarnai calls it a providerThreadId,
      // and they are the same value. Renamed once, here, rather than teaching
      // the shared panel a second word for the same thing.
      //
      // It is passed on verbatim: desktop Outlook hands out the EWS base64
      // alphabet while Graph stores the URL-safe one, and that translation is
      // done server-side (normalizeProviderThreadId) so this pane and the Gmail
      // content script cannot drift on id handling.
      return subscribeOutlookContext(office, (context) => {
        const mapped: PanelThreadContext | null = context
          ? {
              providerThreadId: context.conversationId,
              accountEmail: context.accountEmail,
            }
          : null;
        listener(mapped);
      });
    },

    onVisibilityChanged(listener) {
      // A task pane that is not on screen is not running: Outlook tears the
      // document down rather than hiding it. The only visibility this pane can
      // lose is the whole Outlook window being backgrounded, which the shared
      // SSE hook already handles through document.visibilityState.
      listener(true);
      return () => {};
    },

    insertDraft(html) {
      try {
        insertReplyDraft(office, html);
        return Promise.resolve(true);
      } catch {
        // No item selected, or the host refused. The panel keeps the draft on
        // screen with copy still available rather than claiming it inserted.
        return Promise.resolve(false);
      }
    },

    requestSignIn: onRequestSignIn,

    openExternal() {
      // Unreachable: capabilities.openExternal is false, so the panel never
      // renders a control that calls this.
    },
  };
}
