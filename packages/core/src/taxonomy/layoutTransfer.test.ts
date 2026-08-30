import { describe, it, expect } from "vitest";
import type { TaxonomyTransferFile } from "@aziru/shared";
import { layoutTaxonomyTransfer } from "./layoutTransfer.js";

function node(ref: string, isRoot = false) {
  return {
    ref,
    name: ref === "root" ? "Inbox" : ref,
    description: isRoot ? null : `${ref} folder description that is long enough.`,
    instructions: null,
    draftPrompt: null,
    examples: [],
    isRoot,
    positionX: 999,
    positionY: 999,
  };
}

// root → a (leaf), root → b → b1, b2 (leaves)
const file: TaxonomyTransferFile = {
  amarnaiTaxonomyVersion: 1,
  exportedAt: "2026-06-24T00:00:00.000Z",
  nodes: [node("root", true), node("a"), node("b"), node("b1"), node("b2")],
  edges: [
    { sourceRef: "root", targetRef: "a" },
    { sourceRef: "root", targetRef: "b" },
    { sourceRef: "b", targetRef: "b1" },
    { sourceRef: "b", targetRef: "b2" },
  ],
};

describe("layoutTaxonomyTransfer", () => {
  const out = layoutTaxonomyTransfer(file);
  const pos = (ref: string) => {
    const n = out.nodes.find((x) => x.ref === ref)!;
    return { x: n.positionX, y: n.positionY };
  };

  it("places each depth level further right (left-to-right)", () => {
    expect(pos("root").x).toBe(0);
    expect(pos("a").x).toBe(300);
    expect(pos("b").x).toBe(300);
    expect(pos("b1").x).toBe(600);
    expect(pos("b2").x).toBe(600);
  });

  it("spaces leaves vertically and centers parents on their children", () => {
    // Leaves a, b1, b2 in order → raw y 0, 140, 280; b = midpoint(140,280)=210.
    // Centered on root: root.y becomes 0, everything shifted by -rootY.
    const b1 = pos("b1").y;
    const b2 = pos("b2").y;
    expect(b2 - b1).toBe(140);
    expect(pos("b").y).toBeCloseTo((b1 + b2) / 2);
  });

  it("centers the tree on the root", () => {
    expect(pos("root").y).toBe(0);
  });

  it("overwrites the incoming positions", () => {
    expect(out.nodes.every((n) => !(n.positionX === 999 && n.positionY === 999))).toBe(true);
  });
});
