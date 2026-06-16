import { describe, expect, it } from "vitest";
import {
  TaxonomyTransferFileSchema,
  validateTaxonomyTransfer,
  serializeTaxonomy,
  MAX_TAXONOMY_TRANSFER_NODES,
  MAX_TAXONOMY_TRANSFER_EDGES,
} from "./taxonomy-transfer.js";
import type { TaxonomyTransferFile } from "./taxonomy-transfer.js";
import type { TaxonomyNode, TaxonomyEdge } from "./taxonomy.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_DESCRIPTION = "Emails from clients and project stakeholders";

function makeFile(overrides?: Partial<TaxonomyTransferFile>): TaxonomyTransferFile {
  return {
    amarnaiTaxonomyVersion: 1,
    exportedAt: "2026-06-14T12:00:00.000Z",
    nodes: [
      {
        ref: "root",
        name: "Inbox",
        description: null,
        instructions: null,
        draftPrompt: null,
        examples: [],
        isRoot: true,
        positionX: 0,
        positionY: 0,
      },
      {
        ref: "n1",
        name: "Invoices",
        description: VALID_DESCRIPTION,
        instructions: null,
        draftPrompt: null,
        examples: [],
        isRoot: false,
        positionX: 100,
        positionY: 80,
      },
    ],
    edges: [{ sourceRef: "root", targetRef: "n1" }],
    ...overrides,
  };
}

// ─── TaxonomyTransferFileSchema ────────────────────────────────────────────────

describe("TaxonomyTransferFileSchema", () => {
  it("accepts a valid file", () => {
    const result = TaxonomyTransferFileSchema.safeParse(makeFile());
    expect(result.success).toBe(true);
  });

  it("rejects unknown version", () => {
    const result = TaxonomyTransferFileSchema.safeParse(
      makeFile({ amarnaiTaxonomyVersion: 2 as unknown as 1 })
    );
    expect(result.success).toBe(false);
  });

  it("rejects too many nodes", () => {
    const nodes = Array.from({ length: MAX_TAXONOMY_TRANSFER_NODES + 1 }, (_, i) => ({
      ref: `n${i}`,
      name: `Node ${i}`,
      description: null,
      instructions: null,
      draftPrompt: null,
      examples: [],
      isRoot: i === 0,
      positionX: 0,
      positionY: 0,
    }));
    const result = TaxonomyTransferFileSchema.safeParse(makeFile({ nodes }));
    expect(result.success).toBe(false);
  });

  it("rejects too many edges", () => {
    const edges = Array.from({ length: MAX_TAXONOMY_TRANSFER_EDGES + 1 }, (_, i) => ({
      sourceRef: "root",
      targetRef: `n${i}`,
    }));
    const result = TaxonomyTransferFileSchema.safeParse(makeFile({ edges }));
    expect(result.success).toBe(false);
  });

  it("rejects NaN position", () => {
    const result = TaxonomyTransferFileSchema.safeParse(
      makeFile({
        nodes: [
          { ref: "root", name: "Inbox", description: null, instructions: null,
            draftPrompt: null, examples: [], isRoot: true, positionX: NaN, positionY: 0 },
        ],
      })
    );
    expect(result.success).toBe(false);
  });

  it("rejects HTML in name", () => {
    const result = TaxonomyTransferFileSchema.safeParse(
      makeFile({
        nodes: [
          { ref: "root", name: "<script>alert(1)</script>", description: null, instructions: null,
            draftPrompt: null, examples: [], isRoot: true, positionX: 0, positionY: 0 },
        ],
      })
    );
    expect(result.success).toBe(false);
  });

  it("rejects HTML in instructions", () => {
    const file = makeFile();
    file.nodes[1]!.instructions = '<img onerror="x">';
    const result = TaxonomyTransferFileSchema.safeParse(file);
    expect(result.success).toBe(false);
  });

  it("rejects HTML in examples", () => {
    const file = makeFile();
    file.nodes[1]!.examples = ['<b>bad</b>'];
    const result = TaxonomyTransferFileSchema.safeParse(file);
    expect(result.success).toBe(false);
  });
});

// ─── validateTaxonomyTransfer ─────────────────────────────────────────────────

describe("validateTaxonomyTransfer", () => {
  it("accepts a valid file", () => {
    const result = validateTaxonomyTransfer(makeFile());
    expect(result.ok).toBe(true);
  });

  it("rejects duplicate refs", () => {
    const file = makeFile({
      nodes: [
        { ref: "root", name: "Inbox", description: null, instructions: null,
          draftPrompt: null, examples: [], isRoot: true, positionX: 0, positionY: 0 },
        { ref: "root", name: "Duplicate", description: VALID_DESCRIPTION, instructions: null,
          draftPrompt: null, examples: [], isRoot: false, positionX: 100, positionY: 0 },
      ],
    });
    const result = validateTaxonomyTransfer(file);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/Duplicate node ref/);
  });

  it("rejects zero root nodes", () => {
    const file = makeFile({
      nodes: [
        { ref: "n1", name: "Invoices", description: VALID_DESCRIPTION, instructions: null,
          draftPrompt: null, examples: [], isRoot: false, positionX: 0, positionY: 0 },
      ],
      edges: [],
    });
    const result = validateTaxonomyTransfer(file);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/exactly one root/);
  });

  it("rejects two root nodes", () => {
    const file = makeFile({
      nodes: [
        { ref: "r1", name: "Inbox", description: null, instructions: null,
          draftPrompt: null, examples: [], isRoot: true, positionX: 0, positionY: 0 },
        { ref: "r2", name: "Inbox2", description: null, instructions: null,
          draftPrompt: null, examples: [], isRoot: true, positionX: 100, positionY: 0 },
      ],
      edges: [],
    });
    const result = validateTaxonomyTransfer(file);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/exactly one root/);
  });

  it("rejects non-root node with invalid name (too short)", () => {
    const file = makeFile({
      nodes: [
        { ref: "root", name: "Inbox", description: null, instructions: null,
          draftPrompt: null, examples: [], isRoot: true, positionX: 0, positionY: 0 },
        { ref: "n1", name: "AB", description: VALID_DESCRIPTION, instructions: null,
          draftPrompt: null, examples: [], isRoot: false, positionX: 100, positionY: 0 },
      ],
    });
    const result = validateTaxonomyTransfer(file);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/at least 3 characters/);
  });

  it("rejects non-root node with missing description", () => {
    const file = makeFile({
      nodes: [
        { ref: "root", name: "Inbox", description: null, instructions: null,
          draftPrompt: null, examples: [], isRoot: true, positionX: 0, positionY: 0 },
        { ref: "n1", name: "Invoices", description: null, instructions: null,
          draftPrompt: null, examples: [], isRoot: false, positionX: 100, positionY: 0 },
      ],
    });
    const result = validateTaxonomyTransfer(file);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/description is required/);
  });

  it("rejects description too short", () => {
    const file = makeFile({
      nodes: [
        { ref: "root", name: "Inbox", description: null, instructions: null,
          draftPrompt: null, examples: [], isRoot: true, positionX: 0, positionY: 0 },
        { ref: "n1", name: "Invoices", description: "Short", instructions: null,
          draftPrompt: null, examples: [], isRoot: false, positionX: 100, positionY: 0 },
      ],
    });
    const result = validateTaxonomyTransfer(file);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/30 non-whitespace/);
  });

  it("rejects description equal to name", () => {
    // Name must be 30+ non-whitespace chars so it passes the description
    // length check and reaches the "must differ" rule, while staying within
    // the 40-character name limit.
    const longName = "Billing payments and invoices today";
    const file = makeFile({
      nodes: [
        { ref: "root", name: "Inbox", description: null, instructions: null,
          draftPrompt: null, examples: [], isRoot: true, positionX: 0, positionY: 0 },
        { ref: "n1", name: longName, description: longName, instructions: null,
          draftPrompt: null, examples: [], isRoot: false, positionX: 100, positionY: 0 },
      ],
    });
    const result = validateTaxonomyTransfer(file);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/description must differ/);
  });

  it("rejects edge with unknown sourceRef", () => {
    const file = makeFile({
      edges: [{ sourceRef: "unknown", targetRef: "n1" }],
    });
    const result = validateTaxonomyTransfer(file);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/unknown source ref/);
  });

  it("rejects edge with unknown targetRef", () => {
    const file = makeFile({
      edges: [{ sourceRef: "root", targetRef: "missing" }],
    });
    const result = validateTaxonomyTransfer(file);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/unknown target ref/);
  });

  it("rejects edge targeting the root", () => {
    const file = makeFile({
      nodes: [
        { ref: "root", name: "Inbox", description: null, instructions: null,
          draftPrompt: null, examples: [], isRoot: true, positionX: 0, positionY: 0 },
        { ref: "n1", name: "Invoices", description: VALID_DESCRIPTION, instructions: null,
          draftPrompt: null, examples: [], isRoot: false, positionX: 100, positionY: 0 },
      ],
      edges: [
        { sourceRef: "root", targetRef: "n1" },
        { sourceRef: "n1", targetRef: "root" },
      ],
    });
    const result = validateTaxonomyTransfer(file);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/root node cannot be the target/);
  });

  it("rejects node with multiple parents", () => {
    const file = makeFile({
      nodes: [
        { ref: "root", name: "Inbox", description: null, instructions: null,
          draftPrompt: null, examples: [], isRoot: true, positionX: 0, positionY: 0 },
        { ref: "n1", name: "Invoices", description: VALID_DESCRIPTION, instructions: null,
          draftPrompt: null, examples: [], isRoot: false, positionX: 100, positionY: 0 },
        { ref: "n2", name: "Receipts", description: VALID_DESCRIPTION + " extra text here", instructions: null,
          draftPrompt: null, examples: [], isRoot: false, positionX: 200, positionY: 0 },
        { ref: "n3", name: "Bills", description: VALID_DESCRIPTION + " and more content", instructions: null,
          draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: 0 },
      ],
      edges: [
        { sourceRef: "root", targetRef: "n1" },
        { sourceRef: "root", targetRef: "n2" },
        // n3 has two parents — violates tree constraint
        { sourceRef: "n1", targetRef: "n3" },
        { sourceRef: "n2", targetRef: "n3" },
      ],
    });
    const result = validateTaxonomyTransfer(file);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/more than one parent/);
  });

  it("rejects a cycle", () => {
    // n1 and n2 form a cycle disconnected from root. Each has exactly one
    // parent (within the cycle), so the multi-parent check does not fire;
    // only the cycle-detection DFS catches it.
    const file = makeFile({
      nodes: [
        { ref: "root", name: "Inbox", description: null, instructions: null,
          draftPrompt: null, examples: [], isRoot: true, positionX: 0, positionY: 0 },
        { ref: "n1", name: "Invoices", description: VALID_DESCRIPTION, instructions: null,
          draftPrompt: null, examples: [], isRoot: false, positionX: 100, positionY: 0 },
        { ref: "n2", name: "Receipts", description: VALID_DESCRIPTION + " extra text here", instructions: null,
          draftPrompt: null, examples: [], isRoot: false, positionX: 200, positionY: 0 },
      ],
      edges: [
        // No edge from root — n1 and n2 are disconnected, forming a pure cycle
        { sourceRef: "n1", targetRef: "n2" },
        { sourceRef: "n2", targetRef: "n1" },
      ],
    });
    const result = validateTaxonomyTransfer(file);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/cycle/);
  });

  it("does not pollute Object.prototype when ref is __proto__", () => {
    const file = makeFile({
      nodes: [
        { ref: "__proto__", name: "Inbox", description: null, instructions: null,
          draftPrompt: null, examples: [], isRoot: true, positionX: 0, positionY: 0 },
        { ref: "n1", name: "Invoices", description: VALID_DESCRIPTION, instructions: null,
          draftPrompt: null, examples: [], isRoot: false, positionX: 100, positionY: 0 },
      ],
      edges: [{ sourceRef: "__proto__", targetRef: "n1" }],
    });
    validateTaxonomyTransfer(file);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((({}) as any).polluted).toBeUndefined();
  });
});

// ─── serializeTaxonomy ────────────────────────────────────────────────────────

describe("serializeTaxonomy", () => {
  const NOW = "2026-06-14T00:00:00.000Z";

  const nodes: TaxonomyNode[] = [
    {
      id: "node_root",
      workspaceId: "ws_1",
      name: "Inbox",
      description: null,
      instructions: null,
      draftPrompt: null,
      examples: [],
      isRoot: true,
      positionX: 0,
      positionY: 0,
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: "node_1",
      workspaceId: "ws_1",
      name: "Invoices",
      description: VALID_DESCRIPTION,
      instructions: null,
      draftPrompt: null,
      examples: [],
      isRoot: false,
      positionX: 100,
      positionY: 80,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ];

  const edges: TaxonomyEdge[] = [
    {
      id: "edge_1",
      workspaceId: "ws_1",
      sourceNodeId: "node_root",
      targetNodeId: "node_1",
      createdAt: NOW,
      updatedAt: NOW,
    },
  ];

  it("produces a valid file", () => {
    const file = serializeTaxonomy(nodes, edges);
    expect(file.amarnaiTaxonomyVersion).toBe(1);
    expect(file.nodes).toHaveLength(2);
    expect(file.edges).toHaveLength(1);
  });

  it("uses node id as ref", () => {
    const file = serializeTaxonomy(nodes, edges);
    expect(file.nodes[0]!.ref).toBe("node_root");
    expect(file.nodes[1]!.ref).toBe("node_1");
  });

  it("maps sourceNodeId/targetNodeId to sourceRef/targetRef", () => {
    const file = serializeTaxonomy(nodes, edges);
    expect(file.edges[0]).toEqual({ sourceRef: "node_root", targetRef: "node_1" });
  });

  it("strips workspaceId, createdAt, updatedAt", () => {
    const file = serializeTaxonomy(nodes, edges);
    for (const node of file.nodes) {
      expect(node).not.toHaveProperty("workspaceId");
      expect(node).not.toHaveProperty("createdAt");
      expect(node).not.toHaveProperty("updatedAt");
      expect(node).not.toHaveProperty("id");
    }
  });

  it("round-trips through validateTaxonomyTransfer", () => {
    const file = serializeTaxonomy(nodes, edges);
    const result = validateTaxonomyTransfer(file);
    expect(result.ok).toBe(true);
  });
});
