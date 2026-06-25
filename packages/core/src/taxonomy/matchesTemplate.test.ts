import { describe, it, expect } from "vitest";
import { matchesTemplate } from "./matchesTemplate.js";
import { localizeTemplate } from "./localizeTemplate.js";
import { TAXONOMY_TEMPLATES } from "./templates.js";

// Rebuild a DB-shaped taxonomy from a template's transfer file, mapping refs to
// synthetic ids (DB ids never equal template refs).
function dbFromTemplate(idx: number) {
  const tpl = TAXONOMY_TEMPLATES[idx]!;
  const refToId = new Map(tpl.file.nodes.map((n, i) => [n.ref, `id${i}`]));
  const nodes = tpl.file.nodes.map((n) => ({ id: refToId.get(n.ref)!, name: n.name }));
  const edges = tpl.file.edges.map((e) => ({
    sourceNodeId: refToId.get(e.sourceRef)!,
    targetNodeId: refToId.get(e.targetRef)!,
  }));
  return { tpl, nodes, edges };
}

describe("matchesTemplate", () => {
  it("matches a taxonomy rebuilt from the template", () => {
    const { tpl, nodes, edges } = dbFromTemplate(0);
    expect(matchesTemplate(nodes, edges, tpl)).toBe(true);
  });

  it("does not match when a node is renamed", () => {
    const { tpl, nodes, edges } = dbFromTemplate(0);
    const renamed = nodes.map((n, i) => (i === 1 ? { ...n, name: `${n.name} (changed)` } : n));
    expect(matchesTemplate(renamed, edges, tpl)).toBe(false);
  });

  it("does not match when node or edge counts differ", () => {
    const { tpl, nodes, edges } = dbFromTemplate(0);
    expect(matchesTemplate(nodes.slice(0, -1), edges, tpl)).toBe(false);
    expect(matchesTemplate(nodes, edges.slice(0, -1), tpl)).toBe(false);
  });

  it("does not match a different template", () => {
    if (TAXONOMY_TEMPLATES.length < 2) return;
    const { nodes, edges } = dbFromTemplate(0);
    expect(matchesTemplate(nodes, edges, TAXONOMY_TEMPLATES[1]!)).toBe(false);
  });

  // A localized taxonomy (what apply persists) must match the same template once
  // localized the same way — otherwise the "current" pill and re-apply guard
  // break for non-English users. Compares by name, so both sides must localize.
  it("matches a localized DB taxonomy against its localized template", () => {
    const translate = (s: string): string => `<${s}>`;
    const { tpl } = dbFromTemplate(0);
    const localizedTpl = localizeTemplate(tpl, translate);
    const refToId = new Map(localizedTpl.file.nodes.map((n, i) => [n.ref, `id${i}`]));
    const nodes = localizedTpl.file.nodes.map((n) => ({
      id: refToId.get(n.ref)!,
      name: n.name,
    }));
    const edges = localizedTpl.file.edges.map((e) => ({
      sourceNodeId: refToId.get(e.sourceRef)!,
      targetNodeId: refToId.get(e.targetRef)!,
    }));
    expect(matchesTemplate(nodes, edges, localizedTpl)).toBe(true);
    // And the English template no longer matches the localized DB taxonomy.
    expect(matchesTemplate(nodes, edges, tpl)).toBe(false);
  });
});
