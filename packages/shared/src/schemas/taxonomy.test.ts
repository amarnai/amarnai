import { describe, expect, it } from "vitest";
import {
  TaxonomyNodeSchema,
  CreateTaxonomyNodeInputSchema,
  CreateTaxonomyEdgeInputSchema,
  ClassificationPathStepSchema,
  UpdateTaxonomyNodeInputSchema,
} from "./taxonomy.js";

describe("TaxonomyNodeSchema", () => {
  const base = {
    id: "node_1",
    workspaceId: "ws_1",
    name: "Inbox",
    description: null,
    instructions: null,
    examples: [],
    isRoot: true,
    isVisibleCategory: false,
    canReceiveEmails: false,
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
  };

  it("parses a minimal valid input", () => {
    const result = CreateTaxonomyNodeInputSchema.parse(minimal);
    expect(result.name).toBe("Clients");
  });

  it("parses a full valid input", () => {
    const result = CreateTaxonomyNodeInputSchema.parse({
      ...minimal,
      description: "Emails from clients",
      instructions: "Match emails mentioning client names",
      examples: ["Your project update", "Re: proposal"],
      isVisibleCategory: true,
      canReceiveEmails: true,
      positionX: 100,
      positionY: 200,
    });
    expect(result.isVisibleCategory).toBe(true);
    expect(result.canReceiveEmails).toBe(true);
    expect(result.examples).toEqual(["Your project update", "Re: proposal"]);
  });

  it("rejects missing required fields", () => {
    expect(() => CreateTaxonomyNodeInputSchema.parse({ name: "X" })).toThrow();
    expect(() => CreateTaxonomyNodeInputSchema.parse({ workspaceId: "ws_1" })).toThrow();
  });

  it("rejects name that is too long", () => {
    expect(() =>
      CreateTaxonomyNodeInputSchema.parse({ ...minimal, name: "a".repeat(101) })
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
    const result = UpdateTaxonomyNodeInputSchema.safeParse({ workspaceId: "ws_1", name: "x" });
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
    sortingQuestion: "Is this a client email?",
  };

  it("parses a minimal valid input", () => {
    const result = CreateTaxonomyEdgeInputSchema.parse(minimal);
    expect(result.sortingQuestion).toBe("Is this a client email?");
  });

  it("parses a full valid input", () => {
    const result = CreateTaxonomyEdgeInputSchema.parse({
      ...minimal,
      examples: ["Yes, from acme corp"],
      negativeExamples: ["Newsletter from vendor"],
      priority: 1,
      confidenceThreshold: 0.75,
    });
    expect(result.priority).toBe(1);
    expect(result.confidenceThreshold).toBe(0.75);
  });

  it("rejects confidenceThreshold outside [0, 1]", () => {
    expect(() =>
      CreateTaxonomyEdgeInputSchema.parse({ ...minimal, confidenceThreshold: 1.5 })
    ).toThrow();
    expect(() =>
      CreateTaxonomyEdgeInputSchema.parse({ ...minimal, confidenceThreshold: -0.1 })
    ).toThrow();
  });

  it("rejects missing sorting question", () => {
    const { sortingQuestion: _omit, ...withoutQuestion } = minimal;
    expect(() => CreateTaxonomyEdgeInputSchema.parse(withoutQuestion)).toThrow();
  });

  it("accepts a sortingQuestion of exactly 160 characters", () => {
    const result = CreateTaxonomyEdgeInputSchema.parse({
      ...minimal,
      sortingQuestion: "a".repeat(160),
    });
    expect(result.sortingQuestion).toHaveLength(160);
  });

  it("rejects a sortingQuestion exceeding 160 characters", () => {
    expect(() =>
      CreateTaxonomyEdgeInputSchema.parse({
        ...minimal,
        sortingQuestion: "a".repeat(161),
      })
    ).toThrow();
  });
});

describe("ClassificationPathStepSchema", () => {
  const validStep = {
    edgeId: "edge_1",
    sourceNodeId: "node_0",
    targetNodeId: "node_1",
    sortingQuestion: "Is this a client email?",
    confidence: 0.9,
    explanation: "Matches client criteria",
  };

  it("parses a valid step", () => {
    const result = ClassificationPathStepSchema.parse(validStep);
    expect(result.edgeId).toBe("edge_1");
    expect(result.sourceNodeId).toBe("node_0");
    expect(result.targetNodeId).toBe("node_1");
    expect(result.sortingQuestion).toBe("Is this a client email?");
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
