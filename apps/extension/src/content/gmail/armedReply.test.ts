import { describe, it, expect, beforeEach } from "vitest";
import { armReply, consumeArmedReply, setArmedReplyClock, ARM_TTL_MS } from "./armedReply";

let clock = 0;

beforeEach(() => {
  clock = 1_000_000;
  setArmedReplyClock(() => clock);
  // Drain any arm a previous test left behind (module state is deliberate).
  consumeArmedReply(null);
});

describe("armReply / consumeArmedReply", () => {
  it("fires exactly once for the armed thread", () => {
    armReply("t1");
    expect(consumeArmedReply("t1")).not.toBeNull();
    // A second compose for the same thread must not auto-generate again.
    expect(consumeArmedReply("t1")).toBeNull();
  });

  it("never fires for a different thread's compose", () => {
    armReply("t1");
    expect(consumeArmedReply("t2")).toBeNull();
    // The arm survives the mismatch: the right compose may still be opening.
    expect(consumeArmedReply("t1")).not.toBeNull();
  });

  it("accepts a compose whose thread id could not be read", () => {
    // The arm was set milliseconds earlier from the same conversation;
    // refusing on a null id would strand the user's click.
    armReply("t1");
    expect(consumeArmedReply(null)).not.toBeNull();
  });

  it("expires: an abandoned click cannot surprise-generate later", () => {
    armReply("t1");
    clock += ARM_TTL_MS + 1;
    expect(consumeArmedReply("t1")).toBeNull();
  });

  it("is inert when nothing was armed", () => {
    expect(consumeArmedReply("t1")).toBeNull();
    expect(consumeArmedReply(null)).toBeNull();
  });

  // The panel arms with the draft it is already showing, so the compose inserts
  // that text instead of asking the API for another one.
  it("carries the opener's draft to the compose", () => {
    armReply("t1", "<p>Sounds good.</p>");
    expect(consumeArmedReply("t1")).toEqual({ html: "<p>Sounds good.</p>" });
  });

  it("carries no draft when the opener has none to give", () => {
    armReply("t1");
    expect(consumeArmedReply("t1")).toEqual({ html: null });
  });

  it("re-arming replaces the previous arm", () => {
    armReply("t1");
    armReply("t2");
    expect(consumeArmedReply("t1")).toBeNull();
    expect(consumeArmedReply("t2")).not.toBeNull();
  });
});
