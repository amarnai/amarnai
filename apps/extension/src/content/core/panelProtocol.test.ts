import { describe, it, expect } from "vitest";
import {
  PANEL_PROTOCOL_VERSION,
  PANEL_THREAD_CONTEXT,
  PANEL_VISIBILITY,
  PANEL_INSERT_RESULT,
  PANEL_READY,
  PANEL_INSERT_DRAFT,
  PANEL_OPEN_PANEL,
  isPanelThreadContextMessage,
  isPanelVisibilityMessage,
  isPanelInsertResultMessage,
  isPanelReadyMessage,
  isPanelInsertDraftMessage,
  isPanelOpenPanelMessage,
} from "./panelProtocol";

// These guards run on messages arriving from across an origin boundary, on a
// page full of scripts that are not ours. Everything below is about what they
// must REFUSE: a guard that is merely usually right is a hole.

const V = PANEL_PROTOCOL_VERSION;

describe("panel protocol guards", () => {
  it("accepts each well-formed message", () => {
    expect(
      isPanelThreadContextMessage({
        v: V,
        type: PANEL_THREAD_CONTEXT,
        context: { providerThreadId: "18f0", accountEmail: "ada@example.com" },
      }),
    ).toBe(true);
    // Null context is a real state: the user navigated back to a folder list.
    expect(isPanelThreadContextMessage({ v: V, type: PANEL_THREAD_CONTEXT, context: null })).toBe(true);
    expect(isPanelVisibilityMessage({ v: V, type: PANEL_VISIBILITY, visible: false })).toBe(true);
    expect(
      isPanelInsertResultMessage({ v: V, type: PANEL_INSERT_RESULT, requestId: "i-1", ok: true }),
    ).toBe(true);
    expect(isPanelReadyMessage({ v: V, type: PANEL_READY })).toBe(true);
    expect(
      isPanelInsertDraftMessage({ v: V, type: PANEL_INSERT_DRAFT, requestId: "i-1", html: "<p>hi</p>" }),
    ).toBe(true);
    expect(isPanelOpenPanelMessage({ v: V, type: PANEL_OPEN_PANEL })).toBe(true);
  });

  it("rejects anything that is not an object", () => {
    for (const guard of [
      isPanelThreadContextMessage,
      isPanelVisibilityMessage,
      isPanelInsertResultMessage,
      isPanelReadyMessage,
      isPanelInsertDraftMessage,
      isPanelOpenPanelMessage,
    ]) {
      expect(guard(null)).toBe(false);
      expect(guard(undefined)).toBe(false);
      expect(guard("amarnai:panel:ready")).toBe(false);
      expect(guard(42)).toBe(false);
    }
  });

  // An extension update can reload the content script while an old iframe is
  // still alive. Half-understanding its messages is worse than ignoring them.
  it("rejects a mismatched or missing protocol version", () => {
    expect(isPanelReadyMessage({ v: V + 1, type: PANEL_READY })).toBe(false);
    expect(isPanelReadyMessage({ type: PANEL_READY })).toBe(false);
    expect(isPanelReadyMessage({ v: String(V), type: PANEL_READY })).toBe(false);
  });

  it("does not confuse one message type for another", () => {
    expect(isPanelReadyMessage({ v: V, type: PANEL_OPEN_PANEL })).toBe(false);
    expect(isPanelVisibilityMessage({ v: V, type: PANEL_THREAD_CONTEXT, context: null })).toBe(false);
  });

  it("rejects a thread context missing either id", () => {
    expect(
      isPanelThreadContextMessage({ v: V, type: PANEL_THREAD_CONTEXT, context: { providerThreadId: "18f0" } }),
    ).toBe(false);
    expect(
      isPanelThreadContextMessage({
        v: V,
        type: PANEL_THREAD_CONTEXT,
        context: { providerThreadId: 18, accountEmail: "ada@example.com" },
      }),
    ).toBe(false);
    expect(isPanelThreadContextMessage({ v: V, type: PANEL_THREAD_CONTEXT })).toBe(false);
  });

  it("rejects wrong-typed payload fields", () => {
    expect(isPanelVisibilityMessage({ v: V, type: PANEL_VISIBILITY, visible: "yes" })).toBe(false);
    expect(
      isPanelInsertResultMessage({ v: V, type: PANEL_INSERT_RESULT, requestId: 1, ok: true }),
    ).toBe(false);
    expect(
      isPanelInsertDraftMessage({ v: V, type: PANEL_INSERT_DRAFT, requestId: "i-1", html: null }),
    ).toBe(false);
  });
});
