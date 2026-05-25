import type { TaxonomyNodeInput, TaxonomyEdgeInput } from "../types.js";

export type TaxonomyFixture = {
  name: string;
  nodes: TaxonomyNodeInput[];
  edges: TaxonomyEdgeInput[];
};
