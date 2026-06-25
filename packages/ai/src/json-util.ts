/**
 * Best-effort extraction of a single JSON object from an LLM response.
 *
 * Tolerates: raw JSON, ```json fenced blocks, and prose around a single object.
 * Throws if no JSON object can be found. Shared by every place that parses
 * untrusted model output (node selection, taxonomy generation).
 */
export function extractJSON(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced?.[1]) return JSON.parse(fenced[1]);
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error("No JSON object found in response");
}
