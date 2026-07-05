import { describe, expect, it } from "vitest";
import { detectPanelSide } from "./panelSide";

// Builds a minimal window-like object for detectPanelSide. `screenX` is the
// panel viewport's x on the virtual desktop; `availWidth`/`availLeft` describe
// the monitor it sits on.
function fakeWindow({
  screenX,
  innerWidth,
  availWidth = 1440,
  availLeft = 0,
}: {
  screenX: number;
  innerWidth: number;
  availWidth?: number;
  availLeft?: number;
}): Window {
  return {
    screenX,
    innerWidth,
    screen: { availWidth, availLeft },
  } as unknown as Window;
}

describe("detectPanelSide", () => {
  it("reports left when the panel sits against the left edge", () => {
    // 320px panel flush against the left of a 1440px screen.
    expect(detectPanelSide(fakeWindow({ screenX: 0, innerWidth: 320 }))).toBe(
      "left",
    );
  });

  it("reports right when the panel sits against the right edge", () => {
    // 320px panel flush against the right of a 1440px screen.
    expect(
      detectPanelSide(fakeWindow({ screenX: 1120, innerWidth: 320 })),
    ).toBe("right");
  });

  it("uses the current monitor's origin, not the virtual desktop", () => {
    // Panel on a secondary monitor whose origin is 1440: flush left on it.
    expect(
      detectPanelSide(
        fakeWindow({ screenX: 1440, innerWidth: 320, availLeft: 1440 }),
      ),
    ).toBe("left");
  });
});
