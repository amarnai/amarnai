// What a mounted injected panel offers the rest of the content script.
//
// The panel and the summary widget are deliberately decoupled features that can
// each fail alone, so the widget never holds the panel's internals — only this
// handle, which every no-panel path (missing InboxSDK app id, Gmail without a
// sidebar, OWA already mounted, the workspace's kill switch) collapses to the
// same inert shape. A control that targets the panel checks isLive() and
// renders nothing when it is false.

export type InjectedPanelHandle = {
  /** Tear the panel down (idempotent). */
  stop(): void;
  /** Bring the panel on screen: open Gmail's sidebar / expand OWA's drawer. */
  reveal(): void;
  /** Ask the frame to expand + scroll its Comments section. */
  focusComments(): void;
  /** False when no panel mounted, and after any teardown (incl. kill switch). */
  isLive(): boolean;
};

/** The handle every no-panel path returns: safe to call, does nothing. */
export const inertPanelHandle: InjectedPanelHandle = {
  stop() {},
  reveal() {},
  focusComments() {},
  isLive: () => false,
};
