/**
 * Embedding model identity.
 *
 * Stored taxonomy and thread vectors are only comparable when they were
 * produced by the same model AND the same output dimensionality. The taxonomy
 * vectors live in a Prisma `Float[]` column with no width constraint, so a
 * dimension change does NOT fail at insert time — it fails silently later when
 * `cosineSimilarity` sees mismatched lengths and returns 0.
 *
 * To make a dimension change behave exactly like a model change (and trigger
 * the existing staleness/refresh path), we fold the dimension into the model
 * identity string that is hashed and persisted as `embeddingModel`. The bare
 * API model name is sent to the provider; the composite id is what the rest of
 * the system reasons about.
 *
 *   composeEmbeddingModelId("gemini-embedding-001")        -> "gemini-embedding-001"
 *   composeEmbeddingModelId("gemini-embedding-001", 768)   -> "gemini-embedding-001@768"
 *
 * When no dimension is set, the provider uses its default output size and the
 * id stays bare, preserving backward compatibility with vectors embedded before
 * this knob existed.
 */
export function composeEmbeddingModelId(apiModel: string, dimensions?: number): string {
  return dimensions ? `${apiModel}@${dimensions}` : apiModel;
}
