import { describe, expect, it } from "vitest";
import {
  TaxonomyNodeSchema,
  CreateTaxonomyNodeInputSchema,
  CreateTaxonomyEdgeInputSchema,
  ClassificationPathStepSchema,
  UpdateTaxonomyNodeInputSchema,
  nodeNameSchema,
  nodeDescriptionSchema,
  isPredominantlyCJK,
} from "./taxonomy.js";

// A description with at least 30 non-whitespace characters.
const VALID_DESCRIPTION = "Emails from clients and project stakeholders";

describe("TaxonomyNodeSchema", () => {
  const base = {
    id: "node_1",
    workspaceId: "ws_1",
    name: "Inbox",
    description: null,
    instructions: null,
    draftPrompt: null,
    examples: [],
    isRoot: true,
    positionX: 0,
    positionY: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("parses a valid root node", () => {
    const result = TaxonomyNodeSchema.parse(base);
    expect(result.isRoot).toBe(true);
  });

  it("parses a non-root node", () => {
    const result = TaxonomyNodeSchema.parse({ ...base, isRoot: false, name: "Clients" });
    expect(result.isRoot).toBe(false);
  });

  it("rejects missing isRoot", () => {
    const { isRoot: _omit, ...withoutIsRoot } = base;
    expect(() => TaxonomyNodeSchema.parse(withoutIsRoot)).toThrow();
  });
});

describe("CreateTaxonomyNodeInputSchema", () => {
  const minimal = {
    workspaceId: "ws_1",
    name: "Clients",
    description: VALID_DESCRIPTION,
  };

  it("parses a minimal valid input (name + description)", () => {
    const result = CreateTaxonomyNodeInputSchema.parse(minimal);
    expect(result.name).toBe("Clients");
    expect(result.description).toBe(VALID_DESCRIPTION);
  });

  it("parses a full valid input", () => {
    const result = CreateTaxonomyNodeInputSchema.parse({
      ...minimal,
      instructions: "Match emails mentioning client names",
      examples: ["Your project update", "Re: proposal"],
      positionX: 100,
      positionY: 200,
    });
    expect(result.examples).toEqual(["Your project update", "Re: proposal"]);
  });

  it("rejects missing required fields", () => {
    expect(() => CreateTaxonomyNodeInputSchema.parse({ name: "Node" })).toThrow();
    expect(() => CreateTaxonomyNodeInputSchema.parse({ workspaceId: "ws_1" })).toThrow();
  });

  it("rejects name that is too long (over 40 characters)", () => {
    expect(() =>
      CreateTaxonomyNodeInputSchema.parse({ ...minimal, name: "a".repeat(41) })
    ).toThrow();
  });

  it("rejects description with fewer than 30 non-whitespace characters", () => {
    expect(() =>
      CreateTaxonomyNodeInputSchema.parse({ ...minimal, description: "Short desc" })
    ).toThrow();
  });

  it("accepts description with exactly 30 non-whitespace characters", () => {
    // "a" repeated 30 times — no spaces, 30 non-whitespace chars
    const result = CreateTaxonomyNodeInputSchema.parse({
      workspaceId: "ws_1",
      name: "Node",
      description: "a".repeat(30),
    });
    expect(result.description).toHaveLength(30);
  });

  it("rejects description with 29 non-whitespace characters", () => {
    expect(() =>
      CreateTaxonomyNodeInputSchema.parse({
        workspaceId: "ws_1",
        name: "Node",
        description: "a".repeat(29),
      })
    ).toThrow();
  });
});

describe("UpdateTaxonomyNodeInputSchema", () => {
  it("accepts an empty object (all fields optional)", () => {
    const result = UpdateTaxonomyNodeInputSchema.parse({});
    expect(result).toEqual({});
  });

  it("accepts a partial update", () => {
    const result = UpdateTaxonomyNodeInputSchema.parse({ name: "New name" });
    expect(result.name).toBe("New name");
  });

  it("strips workspaceId (not part of update schema)", () => {
    const result = UpdateTaxonomyNodeInputSchema.safeParse({ workspaceId: "ws_1", name: "Renamed" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("workspaceId" in result.data).toBe(false);
    }
  });
});

describe("CreateTaxonomyEdgeInputSchema", () => {
  const minimal = {
    workspaceId: "ws_1",
    sourceNodeId: "node_a",
    targetNodeId: "node_b",
  };

  it("parses a minimal valid input", () => {
    const result = CreateTaxonomyEdgeInputSchema.parse(minimal);
    expect(result.sourceNodeId).toBe("node_a");
    expect(result.targetNodeId).toBe("node_b");
  });

  it("rejects missing sourceNodeId", () => {
    const { sourceNodeId: _omit, ...without } = minimal;
    expect(() => CreateTaxonomyEdgeInputSchema.parse(without)).toThrow();
  });

  it("rejects missing targetNodeId", () => {
    const { targetNodeId: _omit, ...without } = minimal;
    expect(() => CreateTaxonomyEdgeInputSchema.parse(without)).toThrow();
  });
});

// ─── Script-aware length floors (CJK) ────────────────────────────────────────

describe("CJK-aware name/description floors", () => {
  // 12 kanji, no whitespace — a natural full description in Japanese/Chinese.
  const CJK_DESCRIPTION = "顧客請求支払契約見積納品検収経理税務通知";

  it("detects predominantly-CJK strings", () => {
    expect(isPredominantlyCJK("顧客")).toBe(true);
    expect(isPredominantlyCJK("クライアント")).toBe(true);
    expect(isPredominantlyCJK("Clients")).toBe(false);
    expect(isPredominantlyCJK("")).toBe(false);
  });

  it("accepts a natural 2-character CJK name but rejects 1 character", () => {
    expect(nodeNameSchema.safeParse("顧客").success).toBe(true);
    expect(nodeNameSchema.safeParse("客").success).toBe(false);
  });

  it("still requires 3 characters for Latin names", () => {
    expect(nodeNameSchema.safeParse("ab").success).toBe(false);
    expect(nodeNameSchema.safeParse("abc").success).toBe(true);
  });

  it("accepts a ~12-character CJK description, rejects a much shorter one", () => {
    expect(nodeDescriptionSchema.safeParse(CJK_DESCRIPTION).success).toBe(true);
    expect(nodeDescriptionSchema.safeParse("顧客請求").success).toBe(false);
  });

  it("still requires 30 non-whitespace characters for Latin descriptions", () => {
    expect(nodeDescriptionSchema.safeParse("a".repeat(29)).success).toBe(false);
    expect(nodeDescriptionSchema.safeParse("a".repeat(30)).success).toBe(true);
  });
});

// ─── Inbox-specific policies ─────────────────────────────────────────────────

describe("Inbox node policies", () => {
  const rootNode = {
    id: "node_inbox",
    workspaceId: "ws_1",
    name: "Inbox",
    description: null,
    instructions: null,
    draftPrompt: null,
    examples: [],
    isRoot: true,
    positionX: 0,
    positionY: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("root Inbox node does not require a description (TaxonomyNodeSchema accepts null)", () => {
    const result = TaxonomyNodeSchema.parse(rootNode);
    expect(result.isRoot).toBe(true);
    expect(result.description).toBeNull();
  });

  it("CreateTaxonomyNodeInputSchema requires description (user-created nodes only — Inbox bypasses this schema)", () => {
    // Inbox is seeded directly, never created via the API. The create schema
    // enforces description for all user-created (non-root) nodes.
    expect(() =>
      CreateTaxonomyNodeInputSchema.parse({
        workspaceId: "ws_1",
        name: "Clients",
        // description intentionally omitted
      })
    ).toThrow();
  });
});

// ─── ClassificationPathStep ───────────────────────────────────────────────────

describe("ClassificationPathStepSchema", () => {
  const validStep = {
    edgeId: "edge_1",
    sourceNodeId: "node_0",
    targetNodeId: "node_1",
    confidence: 0.9,
    explanation: "Matches client criteria",
  };

  it("parses a valid step", () => {
    const result = ClassificationPathStepSchema.parse(validStep);
    expect(result.edgeId).toBe("edge_1");
    expect(result.sourceNodeId).toBe("node_0");
    expect(result.targetNodeId).toBe("node_1");
    expect(result.confidence).toBe(0.9);
    expect(result.explanation).toBe("Matches client criteria");
  });

  it("rejects missing required fields", () => {
    expect(() => ClassificationPathStepSchema.parse({ edgeId: "edge_1" })).toThrow();
    expect(() => ClassificationPathStepSchema.parse({ sourceNodeId: "node_0", targetNodeId: "node_1" })).toThrow();
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(() => ClassificationPathStepSchema.parse({ ...validStep, confidence: 1.5 })).toThrow();
    expect(() => ClassificationPathStepSchema.parse({ ...validStep, confidence: -0.1 })).toThrow();
  });
});
