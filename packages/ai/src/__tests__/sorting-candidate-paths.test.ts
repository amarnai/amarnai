import { describe, it, expect } from "vitest";
import { selectCandidatePaths, MAX_CANDIDATE_PATHS } from "../candidate-selector.js";
import type { EmailInput } from "../candidate-selector.js";
import { ALL_NODES, ALL_EDGES, NODES, EDGES, TEST_EMAILS } from "./fixtures/sorting-fixtures.js";
import type { ThreadMessage } from "../types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toEmailInputs(messages: ThreadMessage[]): EmailInput[] {
  return messages.map((m) => ({
    subject: m.subject ?? undefined,
    senderEmail: m.senderEmail,
    senderName: m.senderName ?? undefined,
    bodyText: m.bodyText ?? undefined,
  }));
}

function rankOf(candidates: ReturnType<typeof selectCandidatePaths>["candidates"], nodeId: string): number {
  return candidates.findIndex((c) => c.finalNodeId === nodeId);
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

// ─── Candidate path selection — structural properties ─────────────────────────

describe("candidate paths — structural properties", () => {
  const result = selectCandidatePaths(ALL_NODES, ALL_EDGES, []);

  it("all candidate paths start from Inbox", () => {
    for (const c of result.candidates) {
      expect(c.nodeIds[0], `path "${c.label}" should start from inbox`).toBe(NODES.inbox.id);
    }
  });

  it("root node does not appear as a final destination", () => {
    for (const c of result.candidates) {
      expect(c.finalNodeId, `inbox should not be a final destination`).not.toBe(NODES.inbox.id);
    }
  });

  it("stays within MAX_CANDIDATE_PATHS", () => {
    expect(result.candidates.length).toBeLessThanOrEqual(MAX_CANDIDATE_PATHS);
  });

  it("other/needs-review fallback path is always included", () => {
    const ids = result.candidates.map((c) => c.finalNodeId);
    expect(ids).toContain(NODES.otherNeedsReview.id);
  });

  it("candidate ordering is deterministic across repeated calls", () => {
    const emails = toEmailInputs(TEST_EMAILS[0]!.messages);
    const r1 = selectCandidatePaths(ALL_NODES, ALL_EDGES, emails);
    const r2 = selectCandidatePaths(ALL_NODES, ALL_EDGES, emails);
    expect(r1.candidates.map((c) => c.finalNodeId)).toEqual(r2.candidates.map((c) => c.finalNodeId));
  });

  it("inbox → other path uses the correct edge", () => {
    const otherPath = result.candidates.find((c) => c.finalNodeId === NODES.otherNeedsReview.id);
    expect(otherPath).toBeDefined();
    expect(otherPath!.edgeIds).toContain(EDGES.inboxToOther.id);
  });
});

// ─── Candidate path selection — correct destination despite misleading keywords ──

describe("candidate paths — intended destination survives misleading keywords", () => {
  for (const email of TEST_EMAILS) {
    const emails = toEmailInputs(email.messages);

    it(`${email.id}: expected destination "${email.expectedFinalNodeId}" appears in candidates`, () => {
      const result = selectCandidatePaths(ALL_NODES, ALL_EDGES, emails);
      const ids = result.candidates.map((c) => c.finalNodeId);
      expect(ids).toContain(email.expectedFinalNodeId);
    });

    if (email.misleadingKeywords && email.misleadingKeywords.length > 0) {
      it(`${email.id}: correct destination ranked ahead of the top-scoring misleading candidate`, () => {
        const result = selectCandidatePaths(ALL_NODES, ALL_EDGES, emails);
        const correctRank = rankOf(result.candidates, email.expectedFinalNodeId);

        const topMisleadingRank = result.candidates.findIndex(
          (c) => c.finalNodeId !== email.expectedFinalNodeId
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
      const result = selectCandidatePaths(ALL_NODES, ALL_EDGES, toEmailInputs(email.messages));
      expect(result.candidates[0]?.finalNodeId).toBe(email.expectedFinalNodeId);
    }
  });
});
