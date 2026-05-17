import { describe, expect, it } from "vitest";
import {
  CreateTaxonomyNodeInputSchema,
  DraftBehaviorSchema,
  TaxonomyNodeKindSchema,
  UpdateTaxonomyNodeInputSchema,
} from "./taxonomy.js";

describe("TaxonomyNodeKindSchema", () => {
  it("accepts valid kinds", () => {
    expect(TaxonomyNodeKindSchema.parse("CATEGORY")).toBe("CATEGORY");
    expect(TaxonomyNodeKindSchema.parse("RULE")).toBe("RULE");
  });

  it("rejects invalid values", () => {
    expect(() => TaxonomyNodeKindSchema.parse("FOLDER")).toThrow();
    expect(() => TaxonomyNodeKindSchema.parse("")).toThrow();
  });
});

describe("DraftBehaviorSchema", () => {
  it("accepts valid values", () => {
    expect(DraftBehaviorSchema.parse("DISABLED")).toBe("DISABLED");
    expect(DraftBehaviorSchema.parse("MANUAL_REVIEW")).toBe("MANUAL_REVIEW");
    expect(DraftBehaviorSchema.parse("CREATE_GMAIL_DRAFT")).toBe("CREATE_GMAIL_DRAFT");
  });

  it("rejects invalid values", () => {
    expect(() => DraftBehaviorSchema.parse("AUTO_SEND")).toThrow();
  });
});

describe("CreateTaxonomyNodeInputSchema", () => {
  const minimal = {
    workspaceId: "ws_1",
    kind: "CATEGORY" as const,
    name: "Receipts",
  };

  it("parses a minimal valid input", () => {
    const result = CreateTaxonomyNodeInputSchema.parse(minimal);
    expect(result.name).toBe("Receipts");
    expect(result.kind).toBe("CATEGORY");
  });

  it("parses a full valid input", () => {
    const result = CreateTaxonomyNodeInputSchema.parse({
      ...minimal,
      description: "Purchase receipts",
      instructions: "Match emails with subject containing 'receipt'",
      examples: ["Your order receipt", "Payment confirmation"],
      confidenceThreshold: 0.85,
      draftBehavior: "CREATE_GMAIL_DRAFT",
      syncToGmail: true,
      positionX: 100,
      positionY: 200,
    });
    expect(result.confidenceThreshold).toBe(0.85);
    expect(result.draftBehavior).toBe("CREATE_GMAIL_DRAFT");
  });

  it("rejects missing required fields", () => {
    expect(() => CreateTaxonomyNodeInputSchema.parse({ kind: "CATEGORY" })).toThrow();
    expect(() => CreateTaxonomyNodeInputSchema.parse({ workspaceId: "ws_1" })).toThrow();
  });

  it("rejects name that is too long", () => {
    expect(() =>
      CreateTaxonomyNodeInputSchema.parse({ ...minimal, name: "a".repeat(101) })
    ).toThrow();
  });

  it("rejects confidenceThreshold outside [0, 1]", () => {
    expect(() =>
      CreateTaxonomyNodeInputSchema.parse({ ...minimal, confidenceThreshold: 1.5 })
    ).toThrow();
    expect(() =>
      CreateTaxonomyNodeInputSchema.parse({ ...minimal, confidenceThreshold: -0.1 })
    ).toThrow();
  });

  it("rejects invalid kind", () => {
    expect(() =>
      CreateTaxonomyNodeInputSchema.parse({ ...minimal, kind: "FOLDER" })
    ).toThrow();
  });
});

describe("UpdateTaxonomyNodeInputSchema", () => {
  it("accepts an empty object (all fields optional)", () => {
    const result = UpdateTaxonomyNodeInputSchema.parse({});
    expect(result).toEqual({});
  });

  it("accepts a partial update", () => {
    const result = UpdateTaxonomyNodeInputSchema.parse({ name: "New name" });
    expect(result.name).toBe("New name");
  });

  it("strips workspaceId (not part of update schema)", () => {
    const result = UpdateTaxonomyNodeInputSchema.safeParse({ workspaceId: "ws_1", name: "x" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("workspaceId" in result.data).toBe(false);
    }
  });
});
