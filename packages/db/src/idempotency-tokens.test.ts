import { describe, it, expect } from "vitest";
import {
  threadSortDedupToken,
  backfillChunkDedupToken,
  taxonomyGenDedupToken,
  lifecycleSendDedupToken,
} from "./idempotency-tokens";

const WINDOW = new Date("2026-06-01T00:00:00Z");

describe("idempotency token builders", () => {
  it("threadSortDedupToken is stable and folds inbox+window+thread", () => {
    expect(threadSortDedupToken("ben@gmail.com", WINDOW, "t1")).toBe(
      "THREAD_SORT_ben@gmail.com_2026-06-01T00:00:00.000Z_t1",
    );
  });

  it("backfill continuation and done tokens differ only by the phase suffix (never collide)", () => {
    const base = {
      inboxKey: "ben@gmail.com",
      windowStart: WINDOW,
      generation: 0,
      startProcessed: 0,
      processed: 500,
    };
    const cont = backfillChunkDedupToken({ ...base, phase: "continuation" });
    const done = backfillChunkDedupToken({ ...base, phase: "done" });
    expect(cont).toBe("BACKFILL_ben@gmail.com_2026-06-01T00:00:00.000Z_g0_0_500");
    expect(done).toBe(`${cont}_done`);
    expect(cont).not.toBe(done);
  });

  it("a different cursor span yields a different backfill token", () => {
    const a = backfillChunkDedupToken({
      inboxKey: "ben@gmail.com", windowStart: WINDOW, generation: 0, startProcessed: 0, processed: 500, phase: "continuation",
    });
    const b = backfillChunkDedupToken({
      inboxKey: "ben@gmail.com", windowStart: WINDOW, generation: 0, startProcessed: 500, processed: 1000, phase: "continuation",
    });
    expect(a).not.toBe(b);
  });

  it("taxonomy and lifecycle tokens are prefixed by the job key", () => {
    expect(taxonomyGenDedupToken("job-7")).toBe("TAXONOMY_GEN_job-7");
    expect(lifecycleSendDedupToken("job-9")).toBe("LIFECYCLE_job-9");
  });
});
