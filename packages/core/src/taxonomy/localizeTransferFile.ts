import type { TaxonomyTransferFile } from "@amarnai/shared";

/** A plain string->string lookup, e.g. Lingui's `i18n._`. Kept generic so
 * @amarnai/core never depends on any i18n library. */
export type Translate = (source: string) => string;

/**
 * Returns a copy of a taxonomy transfer file with every node's user-visible
 * `name` and `description` mapped through `translate`. Structural fields
 * (`ref`, edges, positions, flags) are left untouched, and a `null` description
 * stays `null`. The root node's name is preserved verbatim: it is the "Inbox"
 * convention and is kept identical across templates and LLM-generated taxonomies.
 *
 * Used at every edge that localizes a taxonomy — picker apply (web/mobile) and
 * the worker's fallback seed — so the persisted names always match.
 */
export function localizeTransferFile(
  file: TaxonomyTransferFile,
  translate: Translate,
): TaxonomyTransferFile {
  return {
    ...file,
    nodes: file.nodes.map((node) => ({
      ...node,
      name: node.isRoot ? node.name : translate(node.name),
      description:
        node.description == null ? node.description : translate(node.description),
    })),
  };
}
