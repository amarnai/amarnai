import { describe, it, expect, beforeEach, vi } from "vitest";
import { registerInstallHandler } from "./installHandler";

type InstalledDetails = { reason: string };

function registerAndFire(reason: string) {
  registerInstallHandler();
  const listener = vi.mocked(chrome.runtime.onInstalled.addListener).mock
    .calls[0]?.[0] as unknown as (d: InstalledDetails) => void;
  listener({ reason });
}

describe("installHandler", () => {
  beforeEach(() => {
    vi.mocked(chrome.runtime.onInstalled.addListener).mockClear();
    vi.mocked(chrome.tabs.create).mockClear();
  });

  it("opens the bundled welcome tab on a fresh install", () => {
    registerAndFire("install");
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: "chrome-extension://test/welcome.html",
    });
  });

  it("does not reopen the welcome tab when the extension updates", () => {
    registerAndFire("update");
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });
});
