// Reference threads: manually moved threads kept as per-folder routing
// exemplars (TaxonomyNodeReference). Shared between the API (capture on move),
// the worker (prune after capture, load at sort time), and tests.

/**
 * Maximum reference threads retained per taxonomy node, most recent first.
 * Bounds sort-time memory and compute: at 768 dims a full node costs ~60 KB
 * and 10 extra cosines, so a 30-folder workspace stays under ~2 MB per
 * classify job. Older references are pruned by the capture-reference job.
 */
export const MAX_REFERENCES_PER_NODE = 10;
