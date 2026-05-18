import { describe, expect, it } from "vitest";
import { ClassificationResultSchema } from "./classification.js";

const valid = {
  finalNodeId: "node_1",
  path: [],
  confidence: 0.92,
  priority: "HIGH" as const,
  urgency: "TODAY" as const,
  riskLevel: "LOW" as const,
  requiredAction: "REPLY" as const,
  sensitivity: "NORMAL" as const,
  suggestedNextStep: "CREATE_DRAFT" as const,
  needsHumanReview: false,
};

describe("ClassificationResultSchema", () => {
  it("parses a minimal valid result", () => {
    const result = ClassificationResultSchema.parse(valid);
    expect(result.confidence).toBe(0.92);
    expect(result.priority).toBe("HIGH");
    expect(result.needsHumanReview).toBe(false);
  });

  it("parses a full result with optional fields", () => {
    const result = ClassificationResultSchema.parse({
      ...valid,
      explanation: "Looks urgent",
      dueAt: "2026-05-20T09:00:00.000Z",
      modelProvider: "anthropic",
      modelName: "claude-sonnet-4-6",
      promptVersion: "v1",
      rawOutput: { raw: "json" },
    });
    expect(result.explanation).toBe("Looks urgent");
    expect(result.modelName).toBe("claude-sonnet-4-6");
  });

  it("parses a result with path steps", () => {
    const result = ClassificationResultSchema.parse({
      ...valid,
      path: [
        {
          edgeId: "edge_0",
          sourceNodeId: "node_0",
          targetNodeId: "node_1",
          sortingQuestion: "Is this a client email?",
          confidence: 0.9,
          explanation: "Client email",
        },
      ],
    });
    expect(result.path).toHaveLength(1);
    expect(result.path[0]?.edgeId).toBe("edge_0");
    expect(result.path[0]?.targetNodeId).toBe("node_1");
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(() =>
      ClassificationResultSchema.parse({ ...valid, confidence: 1.1 })
    ).toThrow();
    expect(() =>
      ClassificationResultSchema.parse({ ...valid, confidence: -0.5 })
    ).toThrow();
  });

  it("rejects invalid enum values", () => {
    expect(() =>
      ClassificationResultSchema.parse({ ...valid, priority: "CRITICAL" })
    ).toThrow();
    expect(() =>
      ClassificationResultSchema.parse({ ...valid, urgency: "YESTERDAY" })
    ).toThrow();
    expect(() =>
      ClassificationResultSchema.parse({ ...valid, requiredAction: "IGNORE" })
    ).toThrow();
    expect(() =>
      ClassificationResultSchema.parse({ ...valid, sensitivity: "TOP_SECRET" })
    ).toThrow();
  });

  it("rejects an invalid dueAt format", () => {
    expect(() =>
      ClassificationResultSchema.parse({ ...valid, dueAt: "not-a-date" })
    ).toThrow();
  });

  it("rejects missing required fields", () => {
    const { finalNodeId: _omit, ...withoutNodeId } = valid;
    expect(() => ClassificationResultSchema.parse(withoutNodeId)).toThrow();
  });

  it("accepts all valid RequiredAction values", () => {
    const actions = [
      "NONE", "REPLY", "REVIEW", "APPROVE", "SCHEDULE",
      "PAY", "DELEGATE", "ARCHIVE", "UNKNOWN",
    ] as const;
    for (const action of actions) {
      expect(() =>
        ClassificationResultSchema.parse({ ...valid, requiredAction: action })
      ).not.toThrow();
    }
  });

  it("accepts all valid Sensitivity values", () => {
    const values = [
      "NORMAL", "CONFIDENTIAL", "PERSONAL_DATA", "FINANCIAL", "LEGAL", "SECURITY",
    ] as const;
    for (const v of values) {
      expect(() =>
        ClassificationResultSchema.parse({ ...valid, sensitivity: v })
      ).not.toThrow();
    }
  });
});
