import { describe, it, expect } from "vitest";
import type { TaxonomyTransferFile } from "@amarnai/shared";
import { localizeTransferFile } from "./localizeTransferFile.js";
import { localizeTemplate } from "./localizeTemplate.js";
import { TAXONOMY_TEMPLATES } from "./templates.js";

const upper = (s: string): string => s.toUpperCase();

function file(): TaxonomyTransferFile {
  const node = (
    ref: string,
    name: string,
    description: string | null,
    isRoot = false,
  ) => ({
    ref,
    name,
    description,
    instructions: null,
    draftPrompt: null,
    examples: [],
    isRoot,
    positionX: 1,
    positionY: 2,
  });
  return {
    amarnaiTaxonomyVersion: 1,
    exportedAt: "2026-01-01T00:00:00.000Z",
    nodes: [
      node("root", "Inbox", null, true),
      node("a", "Clients", "Active client work."),
    ],
    edges: [{ sourceRef: "root", targetRef: "a" }],
  };
}

describe("localizeTransferFile", () => {
  it("maps non-root names and descriptions through translate", () => {
    const out = localizeTransferFile(file(), upper);
    const a = out.nodes.find((n) => n.ref === "a")!;
    expect(a.name).toBe("CLIENTS");
    expect(a.description).toBe("ACTIVE CLIENT WORK.");
  });

  it("preserves the root name, refs, edges, and positions", () => {
    const out = localizeTransferFile(file(), upper);
    const root = out.nodes.find((n) => n.isRoot)!;
    expect(root.name).toBe("Inbox");
    expect(root.description).toBeNull();
    expect(out.nodes.map((n) => n.ref)).toEqual(["root", "a"]);
    expect(out.edges).toEqual([{ sourceRef: "root", targetRef: "a" }]);
    expect(out.nodes[1]!.positionX).toBe(1);
  });

  it("keeps a null description null", () => {
    const out = localizeTransferFile(file(), upper);
    expect(out.nodes.find((n) => n.isRoot)!.description).toBeNull();
  });

  it("does not mutate the input", () => {
    const input = file();
    localizeTransferFile(input, upper);
    expect(input.nodes.find((n) => n.ref === "a")!.name).toBe("Clients");
  });
});

describe("localizeTemplate", () => {
  it("maps the template name/description and its file", () => {
    const out = localizeTemplate(TAXONOMY_TEMPLATES[0]!, upper);
    expect(out.name).toBe(TAXONOMY_TEMPLATES[0]!.name.toUpperCase());
    expect(out.description).toBe(TAXONOMY_TEMPLATES[0]!.description.toUpperCase());
    const nonRoot = out.file.nodes.find((n) => !n.isRoot)!;
    expect(nonRoot.name).toBe(nonRoot.name.toUpperCase());
  });
});
