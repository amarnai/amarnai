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
  isVisibleCategory: false,
  canReceiveEmails: false,
};

const LEAF: TaxonomyNodeInput = {
  id: "node-leaf",
  name: "Clients",
  description: null,
  instructions: null,
  examples: [],
  isRoot: false,
  isVisibleCategory: true,
  canReceiveEmails: true,
};

const LEAF_HIDDEN: TaxonomyNodeInput = {
  id: "node-hidden",
  name: "Hidden",
  description: null,
  instructions: null,
  examples: [],
  isRoot: false,
  isVisibleCategory: false,
  canReceiveEmails: true,
};

const LEAF_NO_RECEIVE: TaxonomyNodeInput = {
  id: "node-no-receive",
  name: "NoReceive",
  description: null,
  instructions: null,
  examples: [],
  isRoot: false,
  isVisibleCategory: true,
  canReceiveEmails: false,
};

const EDGE: TaxonomyEdgeInput = {
  id: "edge-1",
  sourceNodeId: "node-root",
  targetNodeId: "node-leaf",
  sortingQuestion: "Is this a client email?",
  examples: [],
  negativeExamples: [],
};

const ALL_NODES = [ROOT, LEAF, LEAF_HIDDEN, LEAF_NO_RECEIVE];
const ALL_EDGES = [EDGE];

function validOutput(overrides: object = {}): string {
  return JSON.stringify({
    finalNodeId: "node-leaf",
    path: [
      { nodeId: "node-root", nodeName: "Inbox" },
      { nodeId: "node-leaf", nodeName: "Clients" },
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
  it("accepts valid output", () => {
    const result = parseAndValidateOutput(validOutput(), ALL_NODES, ALL_EDGES);
    expect(result.finalNodeId).toBe("node-leaf");
    expect(result.needsHumanReview).toBe(false);
    expect(result.confidence).toBe(0.9);
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

  it("returns review-needed when final node is not isVisibleCategory", () => {
    const result = parseAndValidateOutput(
      validOutput({
        finalNodeId: "node-hidden",
        path: [
          { nodeId: "node-root", nodeName: "Inbox" },
          { nodeId: "node-hidden", nodeName: "Hidden" },
        ],
      }),
      ALL_NODES,
      [{ ...EDGE, targetNodeId: "node-hidden" }]
    );
    expect(result.finalNodeId).toBeNull();
    expect(result.needsHumanReview).toBe(true);
    expect(result.explanation).toMatch(/not a valid email destination/);
  });

  it("returns review-needed when final node cannot receive emails", () => {
    const result = parseAndValidateOutput(
      validOutput({
        finalNodeId: "node-no-receive",
        path: [
          { nodeId: "node-root", nodeName: "Inbox" },
          { nodeId: "node-no-receive", nodeName: "NoReceive" },
        ],
      }),
      ALL_NODES,
      [{ ...EDGE, targetNodeId: "node-no-receive" }]
    );
    expect(result.finalNodeId).toBeNull();
    expect(result.needsHumanReview).toBe(true);
    expect(result.explanation).toMatch(/not a valid email destination/);
  });

  it("returns review-needed when path contains unknown nodeId", () => {
    const result = parseAndValidateOutput(
      validOutput({
        path: [
          { nodeId: "node-ghost", nodeName: "Ghost" },
          { nodeId: "node-leaf", nodeName: "Clients" },
        ],
      }),
      ALL_NODES,
      ALL_EDGES
    );
    expect(result.finalNodeId).toBeNull();
    expect(result.needsHumanReview).toBe(true);
    expect(result.explanation).toMatch(/Unknown nodeId in path/);
  });

  it("returns review-needed when path has a step with no connecting edge", () => {
    const result = parseAndValidateOutput(
      validOutput({
        path: [
          { nodeId: "node-leaf", nodeName: "Clients" },
          { nodeId: "node-root", nodeName: "Inbox" },
        ],
      }),
      ALL_NODES,
      ALL_EDGES // edge goes root→leaf, not leaf→root
    );
    expect(result.finalNodeId).toBeNull();
    expect(result.needsHumanReview).toBe(true);
    expect(result.explanation).toMatch(/No edge from/);
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
