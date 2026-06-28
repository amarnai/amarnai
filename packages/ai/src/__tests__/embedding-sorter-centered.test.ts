/**
 * Regression guard for the production routing configuration (B5):
 * Gemini gemini-embedding-001 with scale-invariant + mean-centering
 * (CENTERED_ROUTING_CONFIG).
 *
 * Mean-centering corrects Gemini's anisotropy (every node similarity bunches into
 * a narrow high band ~0.7-0.9), which otherwise collapses the routing margin and
 * sends confident-but-bunched threads — especially non-English ones — to Inbox.
 * Centering keeps the correct node rank #1 while widening the margin ~5x.
 *
 * Uses the committed real Gemini fixture (no network). The LLM is stubbed to
 * needsHumanReview so results reflect the embedding phase alone. These assertions
 * lock in the measured win (intl 2/5 -> 5/5, deep-d3 held 8/8, flat held) so a
 * future change to centering or the descent gate cannot silently regress it.
 */
import { describe, it, expect } from "vitest";
import { sortThreadByEmbedding, CENTERED_ROUTING_CONFIG } from "../embedding/sorter.js";
import { makeRealEmbeddingProvider } from "./fixtures/real-embedding-table.js";
import {
  ALL_NODES, ALL_EDGES, TEST_EMAILS, TEST_EMAILS_INTL,
  ALL_NODES_D3, ALL_EDGES_D3, TEST_EMAILS_D3,
  type TestEmail,
} from "./fixtures/sorting-fixtures.js";
import { ML_FLAT, ML_D3 } from "./fixtures/multilingual/index.js";
import type { AIProvider, TaxonomyNodeInput, TaxonomyEdgeInput } from "../types.js";

const STUB_LLM: AIProvider = {
  providerName: "stub",
  modelName: "stub-llm",
  async chat() {
    return JSON.stringify({
      selectedNodeId: null,
      confidence: 0,
      explanation: "LLM disabled in centered-config fixture tests",
      needsHumanReview: true,
    });
  },
};

const ep = makeRealEmbeddingProvider("gemini-embedding-001@768");

async function countCorrect(
  nodes: TaxonomyNodeInput[],
  edges: TaxonomyEdgeInput[],
  emails: TestEmail[],
): Promise<number> {
  let correct = 0;
  for (const email of emails) {
    const r = await sortThreadByEmbedding(
      ep,
      STUB_LLM,
      nodes as never,
      edges as never,
      email.messages,
      { ...CENTERED_ROUTING_CONFIG },
    );
    if (r.finalNodeId === email.expectedFinalNodeId) correct++;
  }
  return correct;
}

describe("embedding sorter — production centered config (gemini)", () => {
  it("routes every multilingual thread correctly (anisotropy fix)", async () => {
    // The whole point of B5: non-English threads that bunched into Inbox now route.
    expect(await countCorrect(ALL_NODES, ALL_EDGES, TEST_EMAILS_INTL)).toBe(
      TEST_EMAILS_INTL.length,
    );
  });

  it("holds deep-taxonomy accuracy (descent gate uses subtree score under centering)", async () => {
    expect(await countCorrect(ALL_NODES_D3, ALL_EDGES_D3, TEST_EMAILS_D3)).toBe(
      TEST_EMAILS_D3.length,
    );
  });

  it("holds flat English accuracy (no regression)", async () => {
    // 10/11; the lone unclassifiable off-topic thread is an accepted deferral.
    expect(await countCorrect(ALL_NODES, ALL_EDGES, TEST_EMAILS)).toBeGreaterThanOrEqual(10);
  });

  // ── B6: loose guards on the 100-thread multilingual set ──────────────────────
  //
  // LLM-generated fixtures are noisy, so these are tolerant floors that catch a
  // real regression (e.g. centering or the descent gate breaking) without flaking
  // on individual borderline threads. The "ambiguous" (difficulty "hard") threads
  // are expected to defer, so they are excluded from the strict-correct floor.

  async function tally(
    nodes: TaxonomyNodeInput[],
    edges: TaxonomyEdgeInput[],
    emails: TestEmail[],
  ): Promise<{ correct: number; okOrReview: number; total: number; nonHardCorrect: number; nonHardTotal: number }> {
    let correct = 0, okOrReview = 0, nonHardCorrect = 0, nonHardTotal = 0;
    for (const e of emails) {
      const r = await sortThreadByEmbedding(ep, STUB_LLM, nodes as never, edges as never, e.messages, { ...CENTERED_ROUTING_CONFIG });
      const isCorrect = r.finalNodeId === e.expectedFinalNodeId;
      if (isCorrect) correct++;
      if (isCorrect || (e.allowNeedsHumanReview && r.needsHumanReview)) okOrReview++;
      if (e.difficulty !== "hard") {
        nonHardTotal++;
        if (isCorrect) nonHardCorrect++;
      }
    }
    return { correct, okOrReview, total: emails.length, nonHardCorrect, nonHardTotal };
  }

  it("multilingual flat set: strong routing + near-total correct-or-defer", async () => {
    const t = await tally(ALL_NODES, ALL_EDGES, ML_FLAT);
    // Non-ambiguous threads route correctly at a high rate (currently ~95%).
    expect(t.nonHardCorrect / t.nonHardTotal).toBeGreaterThanOrEqual(0.8);
    // Almost everything either routes correctly or defers acceptably.
    expect(t.okOrReview / t.total).toBeGreaterThanOrEqual(0.85);
  });

  it("multilingual deep set: descent gate holds under centering", async () => {
    const t = await tally(ALL_NODES_D3, ALL_EDGES_D3, ML_D3);
    expect(t.correct / t.total).toBeGreaterThanOrEqual(0.75);
  });
});
