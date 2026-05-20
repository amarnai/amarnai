import { describe, expect, it } from "vitest";
import { computeIgnoredReasons, computeNodeValidityWarnings, isMissingSortingQuestion } from "./taxonomyUtils";
import type { TaxonomyNode, TaxonomyEdge } from "@/lib/api";

function makeNode(overrides: Partial<TaxonomyNode> & { id: string }): TaxonomyNode {
  return {
    workspaceId: "ws_1",
    name: overrides.id,
    description: null,
    instructions: null,
    examples: [],
    isRoot: false,
    isVisibleCategory: true,
    canReceiveEmails: true,
    positionX: 0,
    positionY: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeEdge(
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  sortingQuestion = "Is it a receipt?"
): TaxonomyEdge {
  return {
    id,
    workspaceId: "ws_1",
    sourceNodeId,
    targetNodeId,
    sortingQuestion,
    examples: [],
    negativeExamples: [],
    priority: 0,
    confidenceThreshold: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("isMissingSortingQuestion", () => {
  it("treats null as missing", () => expect(isMissingSortingQuestion(null)).toBe(true));
  it("treats empty string as missing", () => expect(isMissingSortingQuestion("")).toBe(true));
  it("treats the default placeholder as missing", () => {
    expect(isMissingSortingQuestion("Describe when emails should follow this path.")).toBe(true);
  });
  it("treats a real question as present", () => {
    expect(isMissingSortingQuestion("Is it a receipt?")).toBe(false);
  });
});

describe("computeIgnoredReasons", () => {
  const root = makeNode({ id: "root", isRoot: true, isVisibleCategory: false, canReceiveEmails: false });

  it("does not flag the root node", () => {
    const result = computeIgnoredReasons([root], []);
    expect(result.has("root")).toBe(false);
  });

  it("flags a non-root node with no incoming edges as no-incoming", () => {
    const leaf = makeNode({ id: "leaf" });
    const result = computeIgnoredReasons([root, leaf], []);
    expect(result.get("leaf")).toBe("no-incoming");
  });

  it("flags a node whose all incoming edges have missing sorting questions as all-invalid", () => {
    const mid = makeNode({ id: "mid" });
    const edge = makeEdge("e1", "root", "mid", "");
    const result = computeIgnoredReasons([root, mid], [edge]);
    expect(result.get("mid")).toBe("all-invalid");
  });

  it("does not flag a valid leaf (visible category + can receive emails)", () => {
    const leaf = makeNode({ id: "leaf", isVisibleCategory: true, canReceiveEmails: true });
    const edge = makeEdge("e1", "root", "leaf");
    const result = computeIgnoredReasons([root, leaf], [edge]);
    expect(result.has("leaf")).toBe(false);
  });

  it("flags an invalid leaf where isVisibleCategory is false", () => {
    const leaf = makeNode({ id: "leaf", isVisibleCategory: false, canReceiveEmails: true });
    const edge = makeEdge("e1", "root", "leaf");
    const result = computeIgnoredReasons([root, leaf], [edge]);
    expect(result.get("leaf")).toBe("invalid-leaf");
  });

  it("flags an invalid leaf where canReceiveEmails is false", () => {
    const leaf = makeNode({ id: "leaf", isVisibleCategory: true, canReceiveEmails: false });
    const edge = makeEdge("e1", "root", "leaf");
    const result = computeIgnoredReasons([root, leaf], [edge]);
    expect(result.get("leaf")).toBe("invalid-leaf");
  });

  it("flags an invalid leaf where both isVisibleCategory and canReceiveEmails are false", () => {
    const leaf = makeNode({ id: "leaf", isVisibleCategory: false, canReceiveEmails: false });
    const edge = makeEdge("e1", "root", "leaf");
    const result = computeIgnoredReasons([root, leaf], [edge]);
    expect(result.get("leaf")).toBe("invalid-leaf");
  });

  it("does not flag an internal node (has outgoing) even if not a visible category", () => {
    const mid = makeNode({ id: "mid", isVisibleCategory: false, canReceiveEmails: false });
    const leaf = makeNode({ id: "leaf" });
    const e1 = makeEdge("e1", "root", "mid");
    const e2 = makeEdge("e2", "mid", "leaf");
    const result = computeIgnoredReasons([root, mid, leaf], [e1, e2]);
    expect(result.has("mid")).toBe(false);
  });

  it("prioritises no-incoming over invalid-leaf for a node with neither incoming nor valid fields", () => {
    const leaf = makeNode({ id: "leaf", isVisibleCategory: false, canReceiveEmails: false });
    const result = computeIgnoredReasons([root, leaf], []);
    expect(result.get("leaf")).toBe("no-incoming");
  });

  it("prioritises all-invalid over invalid-leaf when all incoming edges are missing questions", () => {
    const leaf = makeNode({ id: "leaf", isVisibleCategory: false, canReceiveEmails: false });
    const edge = makeEdge("e1", "root", "leaf", "");
    const result = computeIgnoredReasons([root, leaf], [edge]);
    expect(result.get("leaf")).toBe("all-invalid");
  });
});

describe("computeNodeValidityWarnings", () => {
  const root = makeNode({ id: "root", isRoot: true, isVisibleCategory: false, canReceiveEmails: false });

  it("does not warn for the root node", () => {
    const result = computeNodeValidityWarnings([root], []);
    expect(result.has("root")).toBe(false);
  });

  it("does not warn for a valid leaf (visible + receivable)", () => {
    const leaf = makeNode({ id: "leaf", isVisibleCategory: true, canReceiveEmails: true });
    const result = computeNodeValidityWarnings([root, leaf], []);
    expect(result.has("leaf")).toBe(false);
  });

  it("does not warn for a valid sorting step (not receivable, has valid outgoing)", () => {
    const mid = makeNode({ id: "mid", isVisibleCategory: false, canReceiveEmails: false });
    const leaf = makeNode({ id: "leaf" });
    const e = makeEdge("e1", "mid", "leaf", "Is it urgent?");
    const result = computeNodeValidityWarnings([root, mid, leaf], [e]);
    expect(result.has("mid")).toBe(false);
  });

  describe("dead-end", () => {
    it("warns when canReceiveEmails=false and node is a leaf", () => {
      const node = makeNode({ id: "n", canReceiveEmails: false });
      const result = computeNodeValidityWarnings([root, node], []);
      expect(result.get("n")).toContain("dead-end");
    });

    it("warns when canReceiveEmails=false and all outgoing edges are invalid", () => {
      const mid = makeNode({ id: "mid", canReceiveEmails: false });
      const leaf = makeNode({ id: "leaf" });
      const e = makeEdge("e1", "mid", "leaf", "");
      const result = computeNodeValidityWarnings([root, mid, leaf], [e]);
      expect(result.get("mid")).toContain("dead-end");
    });

    it("does not warn when canReceiveEmails=false but has at least one valid outgoing edge", () => {
      const mid = makeNode({ id: "mid", canReceiveEmails: false });
      const leaf = makeNode({ id: "leaf" });
      const e = makeEdge("e1", "mid", "leaf", "Is it a receipt?");
      const result = computeNodeValidityWarnings([root, mid, leaf], [e]);
      expect(result.get("mid") ?? []).not.toContain("dead-end");
    });

    it("does not warn when canReceiveEmails=true regardless of outgoing edges", () => {
      const leaf = makeNode({ id: "leaf", canReceiveEmails: true });
      const result = computeNodeValidityWarnings([root, leaf], []);
      expect(result.get("leaf") ?? []).not.toContain("dead-end");
    });
  });

  describe("visible-not-receivable", () => {
    it("warns when isVisibleCategory=true and canReceiveEmails=false", () => {
      const node = makeNode({ id: "n", isVisibleCategory: true, canReceiveEmails: false });
      const result = computeNodeValidityWarnings([root, node], []);
      expect(result.get("n")).toContain("visible-not-receivable");
    });

    it("does not warn when both are true", () => {
      const node = makeNode({ id: "n", isVisibleCategory: true, canReceiveEmails: true });
      const result = computeNodeValidityWarnings([root, node], []);
      expect(result.get("n") ?? []).not.toContain("visible-not-receivable");
    });

    it("does not warn when isVisibleCategory=false", () => {
      const node = makeNode({ id: "n", isVisibleCategory: false, canReceiveEmails: false });
      const result = computeNodeValidityWarnings([root, node], []);
      expect(result.get("n") ?? []).not.toContain("visible-not-receivable");
    });
  });

  describe("hidden-destination", () => {
    it("warns when canReceiveEmails=true and isVisibleCategory=false", () => {
      const node = makeNode({ id: "n", isVisibleCategory: false, canReceiveEmails: true });
      const result = computeNodeValidityWarnings([root, node], []);
      expect(result.get("n")).toContain("hidden-destination");
    });

    it("does not warn when isVisibleCategory=true", () => {
      const node = makeNode({ id: "n", isVisibleCategory: true, canReceiveEmails: true });
      const result = computeNodeValidityWarnings([root, node], []);
      expect(result.get("n") ?? []).not.toContain("hidden-destination");
    });

    it("does not warn when canReceiveEmails=false", () => {
      const node = makeNode({ id: "n", isVisibleCategory: false, canReceiveEmails: false });
      const result = computeNodeValidityWarnings([root, node], []);
      expect(result.get("n") ?? []).not.toContain("hidden-destination");
    });
  });

  describe("multiple warnings", () => {
    it("shows dead-end and visible-not-receivable together for a visible leaf that cannot receive", () => {
      const node = makeNode({ id: "n", isVisibleCategory: true, canReceiveEmails: false });
      const result = computeNodeValidityWarnings([root, node], []);
      const warnings = result.get("n") ?? [];
      expect(warnings).toContain("dead-end");
      expect(warnings).toContain("visible-not-receivable");
    });

    it("dead-end and hidden-destination cannot coexist (contradictory canReceiveEmails)", () => {
      const node = makeNode({ id: "n", isVisibleCategory: false, canReceiveEmails: true });
      const result = computeNodeValidityWarnings([root, node], []);
      const warnings = result.get("n") ?? [];
      expect(warnings).not.toContain("dead-end");
      expect(warnings).toContain("hidden-destination");
    });
  });
});
