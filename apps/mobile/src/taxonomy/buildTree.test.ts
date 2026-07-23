import { describe, it, expect } from 'vitest';
import type { TaxonomyNode, TaxonomyEdge } from '@amarnai/api-client';
import { buildTaxonomyTree, flattenVisible } from './buildTree';

let seq = 0;
function node(id: string, isRoot = false): TaxonomyNode {
  return {
    id,
    workspaceId: 'ws1',
    name: id,
    description: null,
    instructions: null,
    draftPrompt: null,
    examples: [],
    isRoot,
    isCatchAll: false,
    colorKey: null,
    positionX: 0,
    positionY: 0,
    createdAt: `2026-01-01T00:00:${String(seq++).padStart(2, '0')}.000Z`,
    updatedAt: '2026-01-01T00:00:00.000Z',
    threadCount: 0,
  };
}

function edge(source: string, target: string): TaxonomyEdge {
  return {
    id: `${source}->${target}`,
    workspaceId: 'ws1',
    sourceNodeId: source,
    targetNodeId: target,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('buildTaxonomyTree', () => {
  it('orders depth-first with correct depth and hasChildren', () => {
    const nodes = [node('root', true), node('a'), node('a1'), node('b')];
    const edges = [edge('root', 'a'), edge('a', 'a1'), edge('root', 'b')];
    const tree = buildTaxonomyTree(nodes, edges);

    expect(tree.rootId).toBe('root');
    expect(tree.rows.map((r) => [r.node.id, r.depth])).toEqual([
      ['root', 0],
      ['a', 1],
      ['a1', 2],
      ['b', 1],
    ]);
    const byId = new Map(tree.rows.map((r) => [r.node.id, r]));
    expect(byId.get('root')!.hasChildren).toBe(true);
    expect(byId.get('a')!.hasChildren).toBe(true);
    expect(byId.get('a1')!.hasChildren).toBe(false);
  });

  it('marks unreachable nodes as ignored and still lists them', () => {
    const nodes = [node('root', true), node('a'), node('orphan'), node('island1'), node('island2')];
    // island1 <-> island2 are connected to each other but not to the root.
    const edges = [edge('root', 'a'), edge('island1', 'island2')];
    const tree = buildTaxonomyTree(nodes, edges);

    const byId = new Map(tree.rows.map((r) => [r.node.id, r]));
    expect(byId.get('a')!.ignored).toBe(false);
    expect(byId.get('orphan')!.ignored).toBe(true);
    expect(byId.get('island1')!.ignored).toBe(true);
    expect(byId.get('island2')!.ignored).toBe(true);
    // All nodes present; root never ignored.
    expect(tree.rows).toHaveLength(5);
    expect(byId.get('root')!.ignored).toBe(false);
  });

  it('returns no root id and lists all nodes when there is no root', () => {
    const nodes = [node('a'), node('b')];
    const tree = buildTaxonomyTree(nodes, []);
    expect(tree.rootId).toBeNull();
    expect(tree.rows.map((r) => r.node.id).sort()).toEqual(['a', 'b']);
    expect(tree.rows.every((r) => r.ignored)).toBe(true);
  });

  it('handles an empty taxonomy', () => {
    const tree = buildTaxonomyTree([], []);
    expect(tree.rows).toEqual([]);
    expect(tree.rootId).toBeNull();
  });
});

describe('flattenVisible', () => {
  it('hides descendants of collapsed nodes', () => {
    const nodes = [node('root', true), node('a'), node('a1'), node('a1x'), node('b')];
    const edges = [edge('root', 'a'), edge('a', 'a1'), edge('a1', 'a1x'), edge('root', 'b')];
    const tree = buildTaxonomyTree(nodes, edges);

    expect(flattenVisible(tree, new Set()).map((r) => r.node.id)).toEqual([
      'root',
      'a',
      'a1',
      'a1x',
      'b',
    ]);
    // Collapsing 'a' hides its whole subtree but keeps sibling 'b'.
    expect(flattenVisible(tree, new Set(['a'])).map((r) => r.node.id)).toEqual([
      'root',
      'a',
      'b',
    ]);
    // Collapsing the root hides everything below it.
    expect(flattenVisible(tree, new Set(['root'])).map((r) => r.node.id)).toEqual(['root']);
  });
});
