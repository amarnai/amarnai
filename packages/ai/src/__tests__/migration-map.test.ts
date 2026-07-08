import { describe, it, expect } from "vitest";
import {
  computeFolderMigrationMap,
  type MigrationOldNode,
  type MigrationNewNode,
} from "../embedding/migration-map.js";

// Orthonormal-ish basis vectors so cosine similarity is easy to reason about.
const V = {
  a: [1, 0, 0, 0],
  b: [0, 1, 0, 0],
  c: [0, 0, 1, 0],
  d: [0, 0, 0, 1],
  // Close to `a` but not identical.
  aish: [0.96, 0.28, 0, 0],
};

function oldNode(p: Partial<MigrationOldNode> & { id: string }): MigrationOldNode {
  return { name: p.id, isCatchAll: false, vector: null, ...p };
}
function newNode(p: Partial<MigrationNewNode> & { ref: string }): MigrationNewNode {
  return { name: p.ref, isCatchAll: false, vector: null, ...p };
}

describe("computeFolderMigrationMap", () => {
  it("always maps the catch-all to the incoming catch-all, non-editable", () => {
    const [s] = computeFolderMigrationMap(
      [oldNode({ id: "old-catch", name: "Updates / Other", isCatchAll: true })],
      [
        newNode({ ref: "new-catch", name: "Bulk", isCatchAll: true }),
        newNode({ ref: "work", name: "Work", vector: V.a }),
      ],
    );
    expect(s!.matchKind).toBe("catch_all");
    expect(s!.suggestedRef).toBe("new-catch");
  });

  it("maps by exact normalized name over embeddings", () => {
    const [s] = computeFolderMigrationMap(
      [oldNode({ id: "o1", name: "  Receipts ", vector: V.a })],
      [
        newNode({ ref: "r1", name: "receipts", vector: V.d }), // name match, far vector
        newNode({ ref: "r2", name: "Purchases", vector: V.a }), // near vector, wrong name
      ],
    );
    expect(s!.matchKind).toBe("name");
    expect(s!.suggestedRef).toBe("r1");
  });

  it("maps by embedding when one candidate is a clear, well-separated winner", () => {
    const [s] = computeFolderMigrationMap(
      [oldNode({ id: "o1", name: "Invoices", vector: V.aish })],
      [
        newNode({ ref: "r1", name: "Billing", vector: V.a }), // near
        newNode({ ref: "r2", name: "Travel", vector: V.b }),
        newNode({ ref: "r3", name: "Social", vector: V.c }),
      ],
    );
    expect(s!.matchKind).toBe("embedding");
    expect(s!.suggestedRef).toBe("r1");
    expect(s!.candidates[0]?.ref).toBe("r1");
  });

  it("falls through to re-sort (null) when no candidate clearly wins", () => {
    // Old vector equidistant-ish from two new folders → ambiguous, no z-winner.
    const ambiguous = [0.7, 0.7, 0, 0];
    const [s] = computeFolderMigrationMap(
      [oldNode({ id: "o1", name: "Misc", vector: ambiguous })],
      [
        newNode({ ref: "r1", name: "Alpha", vector: V.a }),
        newNode({ ref: "r2", name: "Beta", vector: V.b }),
      ],
    );
    expect(s!.suggestedRef).toBeNull();
    expect(s!.matchKind).toBeNull();
  });

  it("skips embedding matching when vectors are absent (mock mode), keeping name matches", () => {
    const [named, unnamed] = computeFolderMigrationMap(
      [
        oldNode({ id: "o1", name: "Work", vector: null }),
        oldNode({ id: "o2", name: "Something Else", vector: null }),
      ],
      [newNode({ ref: "w", name: "work", vector: null })],
    );
    expect(named!.matchKind).toBe("name");
    expect(named!.suggestedRef).toBe("w");
    expect(unnamed!.suggestedRef).toBeNull();
    expect(unnamed!.candidates).toEqual([]);
  });

  it("allows many old folders to map to the same new folder", () => {
    const suggestions = computeFolderMigrationMap(
      [
        oldNode({ id: "o1", name: "Newsletters" }),
        oldNode({ id: "o2", name: "Promos" }),
      ],
      [newNode({ ref: "subs", name: "newsletters" }), newNode({ ref: "p", name: "promos" })],
    );
    expect(suggestions.map((s) => s.suggestedRef)).toEqual(["subs", "p"]);
  });
});
