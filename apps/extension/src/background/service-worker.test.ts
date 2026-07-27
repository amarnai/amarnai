import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The background script runs its wiring at import time, so each case arranges the
// globals, resets modules, then imports it.
beforeEach(() => {
  // The chrome stub's mocks are shared across files; clear call history so the
  // Firefox case can assert setPanelBehavior was NOT called this test.
  vi.mocked(chrome.sidePanel.setPanelBehavior).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("background script — chrome", () => {
  it("binds the toolbar click to the side panel", async () => {
    vi.resetModules();
    await import("./service-worker");
    expect(chrome.sidePanel.setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: true,
    });
  });
});

describe("background script — firefox", () => {
  it("toggles the sidebar on toolbar click (no sidePanel API)", async () => {
    const toggle = vi.fn(async () => {});
    let clickHandler: (() => void) | undefined;
    const fakeBrowser = {
      // No sidePanel — this is what distinguishes Firefox.
      sidebarAction: { toggle, open: vi.fn() },
      action: {
        onClicked: {
          addListener: vi.fn((fn: () => void) => {
            clickHandler = fn;
          }),
        },
      },
      // The background also serves the content scripts' summary requests, on
      // both browsers.
      runtime: { onMessage: { addListener: vi.fn() } },
    };
    vi.stubGlobal("browser", fakeBrowser);
    vi.resetModules();
    await import("./service-worker");

    expect(fakeBrowser.action.onClicked.addListener).toHaveBeenCalledOnce();
    expect(chrome.sidePanel.setPanelBehavior).not.toHaveBeenCalled();

    // Invoking the registered handler toggles the sidebar.
    clickHandler?.();
    expect(toggle).toHaveBeenCalledOnce();
  });
});

describe("background script — content-script message handler", () => {
  it("registers the thread-summary listener synchronously at top level", async () => {
    vi.mocked(chrome.runtime.onMessage.addListener).mockClear();
    vi.resetModules();
    await import("./service-worker");
    // Registered during module evaluation, not inside a promise: an event page is
    // woken BY the message, so a later listener would miss it.
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledOnce();
  });
});
