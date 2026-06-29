import { describe, it, expect } from "vitest";
import { buildBatchKey, parseBatchKey } from "../jobs/batch-key.js";

describe("batch key round-trip", () => {
  it("embed key (no step) round-trips", () => {
    const key = buildBatchKey("ws1", "thread1");
    expect(key).toBe("ws1|thread1");
    expect(parseBatchKey(key)).toEqual({ workspaceId: "ws1", emailThreadId: "thread1" });
  });

  it("LLM key preserves a step that contains colons", () => {
    const step = "llm-ambiguity:root:abc123";
    const key = buildBatchKey("ws1", "thread1", step);
    expect(key).toBe("ws1|thread1|llm-ambiguity:root:abc123");
    expect(parseBatchKey(key)).toEqual({ workspaceId: "ws1", emailThreadId: "thread1", step });
  });

  it("maps strictly by parsed key so a foreign workspace is detectable", () => {
    const parsed = parseBatchKey("other-ws|thread9");
    expect(parsed.workspaceId).toBe("other-ws");
    expect(parsed.workspaceId).not.toBe("ws1");
  });
});
