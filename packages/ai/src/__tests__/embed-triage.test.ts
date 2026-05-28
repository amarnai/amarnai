import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classifyTriageByEmbedding,
  deriveNextStep,
  SENSITIVITY_EXEMPLARS,
  REQUIRED_ACTION_EXEMPLARS,
} from "../triage/embed-triage.js";
import type { EmbeddingProvider } from "../embedding/types.js";
import type { RequiredAction } from "@amarnai/shared";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Must be >= total number of exemplars (6 sensitivity + 9 requiredAction = 15)
// so that oneHot(i) never creates a sparse array with undefined holes.
const DIM = 16;

function zeroVec(): number[] {
  return new Array(DIM).fill(0);
}

/** Unit vector pointing along dimension `i`. */
function oneHot(i: number): number[] {
  const v = zeroVec();
  v[i] = 1;
  return v;
}

/**
 * Build a mock embedding provider that returns a one-hot vector per text based
 * on its index in a provided ordered list. Any text not in the list returns the
 * zero vector.
 */
function makeProvider(orderedTexts: string[], modelName = "mock-v1"): EmbeddingProvider {
  const table = new Map(orderedTexts.map((t, i) => [t, oneHot(i)]));
  return {
    providerName: "mock",
    modelName,
    embed: vi.fn(async (texts: string[]) => texts.map((t) => table.get(t) ?? zeroVec())),
  };
}

// ─── deriveNextStep ───────────────────────────────────────────────────────────

describe("deriveNextStep", () => {
  it.each([
    ["ARCHIVE", "LABEL_ONLY"],
    ["NONE", "LABEL_ONLY"],
    ["REPLY", "CREATE_DRAFT"],
    ["PAY", "OPEN_IN_GMAIL"],
    ["APPROVE", "OPEN_IN_GMAIL"],
    ["SCHEDULE", "CREATE_DRAFT"],
    ["REVIEW", "ASK_USER"],
    ["DELEGATE", "ASK_USER"],
    ["UNKNOWN", "ASK_USER"],
  ] as [RequiredAction, string][])(
    "%s → %s",
    (action, expected) => {
      expect(deriveNextStep(action)).toBe(expected);
    }
  );
});

// ─── classifyTriageByEmbedding ────────────────────────────────────────────────

describe("classifyTriageByEmbedding", () => {
  const sensitivityTexts = Object.values(SENSITIVITY_EXEMPLARS);
  const requiredActionTexts = Object.values(REQUIRED_ACTION_EXEMPLARS);
  const allExemplarTexts = [...sensitivityTexts, ...requiredActionTexts];

  beforeEach(() => {
    // Clear the module-level exemplar cache between tests by re-importing
    // is not practical — instead we rely on distinct model names per test
    // or accept that cache hits are part of the expected behaviour.
  });

  it("selects the correct sensitivity class when thread vector matches FINANCIAL exemplar", async () => {
    const financialIdx = sensitivityTexts.indexOf(SENSITIVITY_EXEMPLARS.FINANCIAL);
    const threadVector = oneHot(financialIdx);
    const provider = makeProvider(allExemplarTexts, "mock-financial");

    const result = await classifyTriageByEmbedding(threadVector, provider);
    expect(result.sensitivity).toBe("FINANCIAL");
  });

  it("selects the correct sensitivity class when thread vector matches SECURITY exemplar", async () => {
    const securityIdx = sensitivityTexts.indexOf(SENSITIVITY_EXEMPLARS.SECURITY);
    const threadVector = oneHot(securityIdx);
    const provider = makeProvider(allExemplarTexts, "mock-security");

    const result = await classifyTriageByEmbedding(threadVector, provider);
    expect(result.sensitivity).toBe("SECURITY");
  });

  it("selects the correct requiredAction class when thread vector matches PAY exemplar", async () => {
    const payIdx = sensitivityTexts.length + requiredActionTexts.indexOf(REQUIRED_ACTION_EXEMPLARS.PAY);
    const threadVector = oneHot(payIdx);
    const provider = makeProvider(allExemplarTexts, "mock-pay");

    const result = await classifyTriageByEmbedding(threadVector, provider);
    expect(result.requiredAction).toBe("PAY");
    expect(result.suggestedNextStep).toBe("OPEN_IN_GMAIL");
  });

  it("selects the correct requiredAction class when thread vector matches REPLY exemplar", async () => {
    const replyIdx = sensitivityTexts.length + requiredActionTexts.indexOf(REQUIRED_ACTION_EXEMPLARS.REPLY);
    const threadVector = oneHot(replyIdx);
    const provider = makeProvider(allExemplarTexts, "mock-reply");

    const result = await classifyTriageByEmbedding(threadVector, provider);
    expect(result.requiredAction).toBe("REPLY");
    expect(result.suggestedNextStep).toBe("CREATE_DRAFT");
  });

  it("falls back to NORMAL and UNKNOWN when thread vector is all zeros (below threshold)", async () => {
    const provider = makeProvider(allExemplarTexts, "mock-zero");
    const result = await classifyTriageByEmbedding(zeroVec(), provider);
    expect(result.sensitivity).toBe("NORMAL");
    expect(result.requiredAction).toBe("UNKNOWN");
    expect(result.suggestedNextStep).toBe("ASK_USER");
  });

  it("caches exemplar embeddings — embed() is called at most once per model per exemplar set", async () => {
    const provider = makeProvider(allExemplarTexts, "mock-cache-test");
    const threadVector = oneHot(0);

    await classifyTriageByEmbedding(threadVector, provider);
    await classifyTriageByEmbedding(threadVector, provider);

    // embed() should have been called twice total (once for sensitivity, once for
    // requiredAction) on the first call, and zero times on the second call because
    // all exemplars are now cached.
    expect((provider.embed as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
});
