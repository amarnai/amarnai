import type { InboxProfile, TaxonomyTransferFile } from "@amarnai/shared";

// Builds the LLM messages that personalize a seed template into a taxonomy that
// fits a specific inbox. The model receives only aggregated, body-free signal
// (sender domains, sender names, subject keywords, Gmail labels) plus the seed.

const SYSTEM_PROMPT = `You are an email-organization assistant. Personalize a STARTING taxonomy of folders to fit a user's inbox, based on aggregated signal about who emails them and about what.

You output a single JSON object describing a folder tree. The shape is exactly:
{
  "amarnaiTaxonomyVersion": 1,
  "exportedAt": "<ISO 8601 timestamp>",
  "nodes": [ { "ref": "<unique string>", "name": "<folder name>", "description": "<what belongs here>", "isRoot": <boolean>, "isCatchAll": <boolean, optional>, "instructions": null, "draftPrompt": null, "examples": [], "positionX": <number>, "positionY": <number> } ],
  "edges": [ { "sourceRef": "<parent ref>", "targetRef": "<child ref>" } ]
}

HARD RULES (violations are rejected):
- Exactly ONE root node with "isRoot": true and "name": "Inbox". Every other node has "isRoot": false.
- It must be a TREE: every non-root node is the target of EXACTLY ONE edge. No cycles. No orphans. The root is never an edge target.
- Folder names: 3 to 40 characters, plain text (no HTML), must contain a letter or digit.
- Every non-root folder needs a "description" of at least 30 non-whitespace characters, plain text, and DIFFERENT from its name.
- Keep ONE catch-all leaf (set "isCatchAll": true on it, e.g. "Updates" or "Other") so automated/bulk mail has a home. Give it a normal description.
- "instructions" and "draftPrompt" must be null; "examples" must be []. Set sensible "positionX"/"positionY" numbers (you may copy the seed's layout).

GUIDANCE:
- Start from the SEED taxonomy. Keep folders that fit, rename ones that nearly fit, add folders for clear recurring themes in the signal, and drop folders with no support in the inbox.
- Aim for a focused tree: roughly 5 to 9 leaf folders. Do not create a folder per sender.
- Do NOT invent folders to capture noise (newsletters, notifications, receipts). That is what the catch-all leaf is for.
- Output ONLY the JSON object. No prose, no markdown fences.`;

/** Compact, ranked list rendering for a profile signal. */
function renderTerms(label: string, terms: { term: string; count: number }[], limit: number): string {
  if (terms.length === 0) return `${label}: (none)`;
  const top = terms
    .slice(0, limit)
    .map((t) => `${t.term} (${t.count})`)
    .join(", ");
  return `${label}: ${top}`;
}

/** Render the seed template's leaf folders (name + description) for the prompt. */
function renderSeed(seed: TaxonomyTransferFile): string {
  const lines = seed.nodes
    .filter((n) => !n.isRoot)
    .map((n) => `- ${n.name}: ${n.description ?? ""}`);
  return lines.join("\n");
}

export function buildTaxonomyGenerationMessages(
  profile: InboxProfile,
  seed: TaxonomyTransferFile,
  matchedTemplateName: string,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const user = `SEED taxonomy (closest match: "${matchedTemplateName}"):
${renderSeed(seed)}

INBOX SIGNAL (aggregated from ${profile.eligibleThreadCount} relevant threads; counts in parentheses):
${renderTerms("Top sender domains", profile.senderDomains, 25)}
${renderTerms("Top sender names", profile.senderNames, 25)}
${renderTerms("Frequent subject keywords", profile.subjectKeywords, 40)}
${renderTerms("Gmail labels", profile.gmailLabels, 25)}

Produce the personalized taxonomy JSON now.`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

/** Build a one-shot repair message appending the validation error. */
export function buildRepairMessage(error: string): { role: "user"; content: string } {
  return {
    role: "user",
    content: `The taxonomy you returned was invalid: ${error}\n\nReturn a corrected JSON object that fixes this and obeys all HARD RULES. Output ONLY the JSON.`,
  };
}
