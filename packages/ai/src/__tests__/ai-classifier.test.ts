import { describe, it, expect, vi } from "vitest";
import { parseAndValidateOutput } from "../validator.js";
import { classifyThread } from "../classify.js";
import type { AIProvider, ClassifyInput, TaxonomyEdgeInput, TaxonomyNodeInput } from "../types.js";

const ROOT: TaxonomyNodeInput = {
  id: "node-root",
  name: "Inbox",
  description: null,
  instructions: null,
  examples: [],
  isRoot: true,
};

const LEAF: TaxonomyNodeInput = {
  id: "node-leaf",
  name: "Clients",
  description: null,
  instructions: null,
  examples: [],
  isRoot: false,
};

const EDGE: TaxonomyEdgeInput = {
  id: "edge-1",
  sourceNodeId: "node-root",
  targetNodeId: "node-leaf",
};

const ALL_NODES = [ROOT, LEAF];
const ALL_EDGES = [EDGE];

// Helpers to produce the LLM raw output (edge-ID based path)
function validOutput(overrides: object = {}): string {
  return JSON.stringify({
    finalNodeId: "node-leaf",
    path: [
      { edgeId: "edge-1", confidence: 0.9, explanation: "Looks like a client email" },
    ],
    confidence: 0.9,
    explanation: "Looks like a client email",
    priority: "MEDIUM",
    urgency: "NONE",
    riskLevel: "LOW",
    requiredAction: "NONE",
    sensitivity: "NORMAL",
    dueAt: null,
    suggestedNextStep: "LABEL_ONLY",
    needsHumanReview: false,
    ...overrides,
  });
}

// ─── AIProvider can be mocked ──────────────────────────────────────────────────

describe("AIProvider interface", () => {
  it("can be implemented as a mock", () => {
    const mockProvider: AIProvider = {
      providerName: "test",
      modelName: "test-model",
      chat: vi.fn().mockResolvedValue("{}"),
    };
    expect(mockProvider.providerName).toBe("test");
    expect(typeof mockProvider.chat).toBe("function");
  });
});

// ─── parseAndValidateOutput ────────────────────────────────────────────────────

describe("parseAndValidateOutput", () => {
  it("accepts valid output and returns enriched path", () => {
    const result = parseAndValidateOutput(validOutput(), ALL_NODES, ALL_EDGES);
    expect(result.finalNodeId).toBe("node-leaf");
    expect(result.needsHumanReview).toBe(false);
    expect(result.confidence).toBe(0.9);
  });

  it("enriches path with sourceNodeId and targetNodeId", () => {
    const result = parseAndValidateOutput(validOutput(), ALL_NODES, ALL_EDGES);
    expect(result.path).toHaveLength(1);
    expect(result.path[0]).toMatchObject({
      edgeId: "edge-1",
      sourceNodeId: "node-root",
      targetNodeId: "node-leaf",
      confidence: 0.9,
      explanation: "Looks like a client email",
    });
  });

  it("parses JSON wrapped in markdown code block", () => {
    const wrapped = "```json\n" + validOutput() + "\n```";
    const result = parseAndValidateOutput(wrapped, ALL_NODES, ALL_EDGES);
    expect(result.finalNodeId).toBe("node-leaf");
  });

  it("returns review-needed on unparseable input", () => {
    const result = parseAndValidateOutput("not json at all", ALL_NODES, ALL_EDGES);
    expect(result.finalNodeId).toBeNull();
    expect(result.needsHumanReview).toBe(true);
    expect(result.explanation).toMatch(/Failed to parse/);
  });

  it("returns review-needed on schema validation failure", () => {
    const result = parseAndValidateOutput(
      JSON.stringify({ finalNodeId: "node-leaf", confidence: "bad" }),
      ALL_NODES,
      ALL_EDGES
    );
    expect(result.needsHumanReview).toBe(true);
    expect(result.explanation).toMatch(/schema validation failed/);
  });

  it("returns review-needed when finalNodeId is unknown", () => {
    const result = parseAndValidateOutput(
      validOutput({ finalNodeId: "node-does-not-exist" }),
      ALL_NODES,
      ALL_EDGES
    );
    expect(result.finalNodeId).toBeNull();
    expect(result.needsHumanReview).toBe(true);
    expect(result.explanation).toMatch(/Unknown finalNodeId/);
  });

  it("resolves finalNodeId by node name when LLM returns name instead of id", () => {
    const result = parseAndValidateOutput(
      validOutput({ finalNodeId: "Clients" }),
      ALL_NODES,
      ALL_EDGES
    );
    expect(result.finalNodeId).toBe("node-leaf");
    expect(result.needsHumanReview).toBe(false);
    expect(result.path).toHaveLength(0);
  });

  it("drops path but keeps finalNodeId when path end and finalNodeId disagree", () => {
    const LEAF2: TaxonomyNodeInput = {
      id: "node-leaf2",
      name: "Other",
      description: null,
      instructions: null,
      examples: [],
      isRoot: false,
    };
    const result = parseAndValidateOutput(
      validOutput({ finalNodeId: "node-leaf2" }),
      [...ALL_NODES, LEAF2],
      ALL_EDGES
    );
    expect(result.finalNodeId).toBe("node-leaf2");
    expect(result.path).toHaveLength(0);
    expect(result.needsHumanReview).toBe(false);
  });

  it("returns review-needed when path contains unknown edgeId", () => {
    const result = parseAndValidateOutput(
      validOutput({
        path: [{ edgeId: "edge-does-not-exist", confidence: 0.9, explanation: "test" }],
      }),
      ALL_NODES,
      ALL_EDGES
    );
    expect(result.finalNodeId).toBeNull();
    expect(result.needsHumanReview).toBe(true);
    expect(result.explanation).toMatch(/Unknown edgeId in path/);
  });

  it("drops disconnected path but keeps valid finalNodeId", () => {
    const edgeParallel: TaxonomyEdgeInput = {
      id: "edge-parallel",
      sourceNodeId: "node-root",
      targetNodeId: "node-leaf",
    };
    const result = parseAndValidateOutput(
      validOutput({
        path: [
          { edgeId: "edge-1", confidence: 0.9, explanation: "test" },
          { edgeId: "edge-parallel", confidence: 0.5, explanation: "test" },
        ],
        finalNodeId: "node-leaf",
      }),
      ALL_NODES,
      [EDGE, edgeParallel]
    );
    expect(result.finalNodeId).toBe("node-leaf");
    expect(result.path).toHaveLength(0);
    expect(result.needsHumanReview).toBe(false);
  });

  it("accepts null finalNodeId with needsHumanReview=true", () => {
    const result = parseAndValidateOutput(
      validOutput({ finalNodeId: null, needsHumanReview: true }),
      ALL_NODES,
      ALL_EDGES
    );
    expect(result.finalNodeId).toBeNull();
    expect(result.needsHumanReview).toBe(true);
  });

  it("returns review-needed when finalNodeId is the root node", () => {
    const result = parseAndValidateOutput(
      validOutput({ finalNodeId: "node-root", path: [] }),
      ALL_NODES,
      ALL_EDGES
    );
    expect(result.finalNodeId).toBeNull();
    expect(result.needsHumanReview).toBe(true);
    expect(result.explanation).toMatch(/Root node/);
  });

  it("accepts an intermediate node (has outgoing edges) as a valid final destination", () => {
    const INTERMEDIATE: TaxonomyNodeInput = {
      id: "node-intermediate",
      name: "Work",
      description: null,
      instructions: null,
      examples: [],
      isRoot: false,
    };
    const edgeToIntermediate: TaxonomyEdgeInput = {
      id: "edge-to-int",
      sourceNodeId: "node-root",
      targetNodeId: "node-intermediate",
    };
    const edgeFromIntermediate: TaxonomyEdgeInput = {
      id: "edge-from-int",
      sourceNodeId: "node-intermediate",
      targetNodeId: "node-leaf",
    };
    const result = parseAndValidateOutput(
      JSON.stringify({
        finalNodeId: "node-intermediate",
        path: [
          { edgeId: "edge-to-int", confidence: 0.7, explanation: "Work email, no specific child matched" },
        ],
        confidence: 0.7,
        explanation: "Work email, no specific child matched",
        priority: "MEDIUM",
        urgency: "NONE",
        riskLevel: "LOW",
        requiredAction: "NONE",
        sensitivity: "NORMAL",
        dueAt: null,
        suggestedNextStep: "LABEL_ONLY",
        needsHumanReview: false,
      }),
      [ROOT, LEAF, INTERMEDIATE],
      [edgeToIntermediate, edgeFromIntermediate]
    );
    expect(result.finalNodeId).toBe("node-intermediate");
    expect(result.needsHumanReview).toBe(false);
  });
});

// ─── Legacy nodes without descriptions ────────────────────────────────────────

describe("legacy nodes without descriptions", () => {
  it("does not crash parseAndValidateOutput when non-root nodes have null description", () => {
    const result = parseAndValidateOutput(validOutput(), ALL_NODES, ALL_EDGES);
    expect(result.finalNodeId).toBe("node-leaf");
    expect(result.needsHumanReview).toBe(false);
  });

  it("does not crash classifyThread when non-root nodes have null description", async () => {
    const provider: AIProvider = {
      providerName: "test",
      modelName: "test-model",
      chat: vi.fn().mockResolvedValue(validOutput()),
    };
    const result = await classifyThread(provider, {
      nodes: [ROOT, LEAF],
      edges: [EDGE],
      messages: [
        {
          subject: "Test",
          senderEmail: "legacy@example.com",
          senderName: "Legacy Sender",
          bodyText: "This is a test email",
          receivedAt: new Date("2026-01-01"),
        },
      ],
    });
    expect(result.finalNodeId).toBe("node-leaf");
    expect(result.needsHumanReview).toBe(false);
  });
});

// ─── classifyThread ────────────────────────────────────────────────────────────

describe("classifyThread", () => {
  const input: ClassifyInput = {
    nodes: [ROOT, LEAF],
    edges: [EDGE],
    messages: [
      {
        subject: "Hello",
        senderEmail: "client@example.com",
        senderName: "Client",
        bodyText: "Can we schedule a call?",
        receivedAt: new Date("2026-01-01"),
      },
    ],
  };

  it("returns parsed classification when provider returns valid JSON", async () => {
    const provider: AIProvider = {
      providerName: "test",
      modelName: "test-model",
      chat: vi.fn().mockResolvedValue(validOutput()),
    };

    const result = await classifyThread(provider, input);
    expect(result.finalNodeId).toBe("node-leaf");
    expect(result.needsHumanReview).toBe(false);
    expect(provider.chat).toHaveBeenCalledTimes(1);
  });

  it("returns review-needed when provider returns invalid JSON", async () => {
    const provider: AIProvider = {
      providerName: "test",
      modelName: "test-model",
      chat: vi.fn().mockResolvedValue("I cannot classify this email."),
    };

    const result = await classifyThread(provider, input);
    expect(result.finalNodeId).toBeNull();
    expect(result.needsHumanReview).toBe(true);
  });
});
