/** Which mailbox the demo is standing in. */
export type MockProvider = "gmail" | "outlook";

/**
 * Everything the Aziru layer needs to draw itself over a mailbox: the label
 * each folder mirrors to, the canned summaries, and the canned draft bodies.
 * Bundled into one prop so the mailbox components take a single "here is the
 * Aziru side of the demo" object instead of five parallel maps.
 */
export type AziruDemoData = {
  /** Folder id → namespace-first provider label segments. */
  providerLabels: Record<string, string[]>;
  /** Thread id → prose TL;DR. Absent for single-message threads, by design. */
  summaries: Record<string, string>;
  /** Thread id → bulleted TL;DR, for threads that enumerate facts. */
  summaryBullets: Record<string, string[]>;
  /** Thread id → the reply body the Aziru Reply button inserts. */
  draftBodies: Record<string, string>;
};
