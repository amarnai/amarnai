// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { mountRailTab } from "./railTab";

const HOST_SELECTOR = "[data-aziru-gmail-rail-tab]";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("mountRailTab", () => {
  it("mounts a shadow-rooted tab on the body that opens on click", () => {
    const onOpen = vi.fn();
    mountRailTab(document, onOpen);

    const host = document.querySelector<HTMLElement>(HOST_SELECTOR);
    expect(host?.parentElement).toBe(document.body);
    const button = host!.shadowRoot!.querySelector<HTMLButtonElement>("button.tab");
    expect(button?.getAttribute("aria-label")).toBe("Open the Aziru panel");

    button!.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("hides while the panel is active, and comes back", () => {
    const tab = mountRailTab(document, () => {});
    const host = document.querySelector<HTMLElement>(HOST_SELECTOR)!;

    tab.setHidden(true);
    expect(host.hasAttribute("data-hidden")).toBe(true);
    tab.setHidden(false);
    expect(host.hasAttribute("data-hidden")).toBe(false);
  });

  it("remove() takes the tab off the page", () => {
    const tab = mountRailTab(document, () => {});
    tab.remove();
    expect(document.querySelector(HOST_SELECTOR)).toBeNull();
  });
});
