import { describe, it, expect } from "vitest";
import { selectCandidateNodes, MAX_CANDIDATE_PATHS } from "../selection/candidate-selector.js";
import type { EmailInput } from "../selection/candidate-selector.js";
import { ALL_NODES, ALL_EDGES, NODES, TEST_EMAILS } from "./fixtures/sorting-fixtures.js";
import type { ThreadMessage } from "../types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toEmailInputs(messages: ThreadMessage[]): EmailInput[] {
  return messages.map((m) => ({
    ...(m.subject != null ? { subject: m.subject } : {}),
    senderEmail: m.senderEmail,
    ...(m.senderName != null ? { senderName: m.senderName } : {}),
    ...(m.bodyText != null ? { bodyText: m.bodyText } : {}),
  }));
}

function rankOf(candidates: ReturnType<typeof selectCandidateNodes>["candidates"], nodeId: string): number {
  return candidates.findIndex((c) => c.nodeId === nodeId);
}

// ─── Fixture validity ─────────────────────────────────────────────────────────

describe("sorting fixtures — validity", () => {
  const leafNodes = ALL_NODES.filter((n) => !ALL_EDGES.some((e) => e.sourceNodeId === n.id));
  const nodeIds = new Set(ALL_NODES.map((n) => n.id));

  it("every leaf node has a non-null description", () => {
    for (const n of leafNodes) {
      if (n.isRoot) continue;
      expect(n.description, `${n.name} should have a description`).not.toBeNull();
    }
  });

  it("exactly one root node exists", () => {
    const roots = ALL_NODES.filter((n) => n.isRoot);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.id).toBe(NODES.inbox.id);
  });

  it("every edge references valid node IDs", () => {
    for (const e of ALL_EDGES) {
      expect(nodeIds.has(e.sourceNodeId), `edge ${e.id}: unknown source ${e.sourceNodeId}`).toBe(true);
      expect(nodeIds.has(e.targetNodeId), `edge ${e.id}: unknown target ${e.targetNodeId}`).toBe(true);
    }
  });

  it("test emails reference node IDs that exist in the taxonomy", () => {
    for (const email of TEST_EMAILS) {
      expect(
        nodeIds.has(email.expectedFinalNodeId),
        `email ${email.id}: unknown expectedFinalNodeId "${email.expectedFinalNodeId}"`
      ).toBe(true);
    }
  });
});

// ─── Candidate node selection — structural properties ─────────────────────────

describe("candidate nodes — structural properties", () => {
  const result = selectCandidateNodes(ALL_NODES, ALL_EDGES, []);

  it("all candidate nodes have a breadcrumb starting from Inbox", () => {
    for (const c of result.candidates) {
      expect(c.breadcrumb, `candidate "${c.name}" should have a breadcrumb starting from Inbox`).toMatch(/^Inbox/);
    }
  });

  it("root node does not appear as a candidate destination", () => {
    for (const c of result.candidates) {
      expect(c.nodeId, `inbox should not be a candidate destination`).not.toBe(NODES.inbox.id);
    }
  });

  it("stays within MAX_CANDIDATE_PATHS", () => {
    expect(result.candidates.length).toBeLessThanOrEqual(MAX_CANDIDATE_PATHS);
  });

  it("other/needs-review fallback node is always included", () => {
    const ids = result.candidates.map((c) => c.nodeId);
    expect(ids).toContain(NODES.otherNeedsReview.id);
  });

  it("candidate ordering is deterministic across repeated calls", () => {
    const emails = toEmailInputs(TEST_EMAILS[0]!.messages);
    const r1 = selectCandidateNodes(ALL_NODES, ALL_EDGES, emails);
    const r2 = selectCandidateNodes(ALL_NODES, ALL_EDGES, emails);
    expect(r1.candidates.map((c) => c.nodeId)).toEqual(r2.candidates.map((c) => c.nodeId));
  });

  it("candidates expose node-level fields only — no path or edge IDs", () => {
    for (const c of result.candidates) {
      expect(c).toHaveProperty("nodeId");
      expect(c).toHaveProperty("name");
      expect(c).toHaveProperty("score");
      expect(c).not.toHaveProperty("pathId");
      expect(c).not.toHaveProperty("edgeIds");
      expect(c).not.toHaveProperty("edgeSteps");
    }
  });
});

// ─── Candidate node selection — correct destination despite misleading keywords ──

describe("candidate nodes — intended destination survives misleading keywords", () => {
  for (const email of TEST_EMAILS) {
    const emails = toEmailInputs(email.messages);

    it(`${email.id}: expected destination "${email.expectedFinalNodeId}" appears in candidates`, () => {
      const result = selectCandidateNodes(ALL_NODES, ALL_EDGES, emails);
      const ids = result.candidates.map((c) => c.nodeId);
      expect(ids).toContain(email.expectedFinalNodeId);
    });

    if (email.misleadingKeywords && email.misleadingKeywords.length > 0) {
      it(`${email.id}: correct destination ranked ahead of the top-scoring misleading candidate`, () => {
        const result = selectCandidateNodes(ALL_NODES, ALL_EDGES, emails);
        const correctRank = rankOf(result.candidates, email.expectedFinalNodeId);

        const topMisleadingRank = result.candidates.findIndex(
          (c) => c.nodeId !== email.expectedFinalNodeId
        );

        expect(correctRank).not.toBe(-1);
        expect(
          correctRank,
          `"${email.expectedFinalNodeId}" ranked ${correctRank} but top misleading candidate ranked ${topMisleadingRank}`
        ).toBeLessThanOrEqual(topMisleadingRank);
      });
    }
  }

  it("easy emails: expected destination is the top-ranked candidate", () => {
    for (const email of TEST_EMAILS.filter((e) => e.difficulty === "easy")) {
      const result = selectCandidateNodes(ALL_NODES, ALL_EDGES, toEmailInputs(email.messages));
      expect(result.candidates[0]?.nodeId).toBe(email.expectedFinalNodeId);
    }
  });
});
