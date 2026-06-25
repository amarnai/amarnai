import type { InboxProfile, SenderCluster, TaxonomyTransferFile } from "@amarnai/shared";

// Builds the LLM messages that personalize a seed template into a taxonomy that
// fits a specific inbox. The model receives only aggregated, body-free signal
// (sender domains, sender names, subject keywords, Gmail labels) plus the seed.

const SYSTEM_PROMPT = `You are an email-organization assistant. Personalize a STARTING taxonomy of folders to fit a user's inbox, based on aggregated signal about who emails them and about what.

You output a single JSON object describing a folder tree. The shape is exactly:
{
  "amarnaiTaxonomyVersion": 1,
  "exportedAt": "<ISO 8601 timestamp>",
  "nodes": [ { "ref": "<unique string>", "name": "<folder name>", "description": "<what belongs here>", "isRoot": <boolean>, "isCatchAll": <boolean, optional>, "instructions": null, "draftPrompt": null, "examples": [], "positionX": <number>, "positionY": <number> } ],
  "edges": [
    { "sourceRef": "root", "targetRef": "<top-level ref>" },
    { "sourceRef": "<top-level ref>", "targetRef": "<sub-folder ref>" }
  ]
}

HARD RULES (violations are rejected):
- Exactly ONE root node with "isRoot": true and "name": "Inbox". Every other node has "isRoot": false.
- It must be a TREE: every non-root node is the target of EXACTLY ONE edge. No cycles. No orphans. The root is never an edge target.
- Folder names: 3 to 40 characters, plain text (no HTML), must contain a letter or digit.
- Every non-root folder needs a "description" of at least 30 non-whitespace characters, plain text, and DIFFERENT from its name.
- Keep ONE catch-all leaf (set "isCatchAll": true on it, e.g. "Updates" or "Other") so automated/bulk mail has a home. Give it a normal description.
- "instructions" and "draftPrompt" must be null; "examples" must be []. Set sensible "positionX"/"positionY" numbers (you may copy the seed's layout).

GUIDANCE:
- Build a TWO-LEVEL tree. Top level: 3 to 6 broad categories (the major areas or relationships in this inbox). Under each top-level category, add 2 to 5 specific sub-folders when the sender clusters show distinct recurring themes within it. If a category has no clear sub-themes, keep it a single leaf.
- Do NOT nest deeper than two levels below "Inbox".
- Start from the SEED taxonomy, which is already two-level. Keep the parts that fit, rename ones that nearly fit, add sub-folders for clear recurring themes in the signal, and drop branches with no support in the inbox.
- Name sub-folders after concrete recurring themes visible in the sender clusters (a frequent sender domain, a project, a keyword cluster), not generic buckets. Do not create a folder per sender.
- Aim for about 8 to 12 leaf folders total. When in doubt, merge rather than split — a few well-supported folders beat many thin ones.
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

/** Render the seed as an indented parent → child tree so the model sees the hierarchy. */
function renderSeed(seed: TaxonomyTransferFile): string {
  const childrenOf = new Map<string, string[]>();
  for (const e of seed.edges) {
    const list = childrenOf.get(e.sourceRef) ?? [];
    list.push(e.targetRef);
    childrenOf.set(e.sourceRef, list);
  }
  const byRef = new Map(seed.nodes.map((n) => [n.ref, n]));
  const root = seed.nodes.find((n) => n.isRoot);
  if (!root) return "";
  const lines: string[] = [];
  const walk = (ref: string, depth: number) => {
    for (const childRef of childrenOf.get(ref) ?? []) {
      const node = byRef.get(childRef);
      if (!node) continue;
      lines.push(`${"  ".repeat(depth)}- ${node.name}: ${node.description ?? ""}`);
      walk(childRef, depth + 1);
    }
  };
  walk(root.ref, 0);
  return lines.join("\n");
}

/** Render per-sender theme clusters: "domain (count): kw, kw, kw". */
function renderClusters(clusters: SenderCluster[]): string {
  if (clusters.length === 0) return "(none)";
  return clusters
    .map((c) => {
      const kws = c.keywords.slice(0, 6).map((k) => k.term).join(", ");
      return `- ${c.label} (${c.count})${kws ? `: ${kws}` : ""}`;
    })
    .join("\n");
}

export function buildTaxonomyGenerationMessages(
  profile: InboxProfile,
  seed: TaxonomyTransferFile,
  matchedTemplateName: string,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const user = `SEED taxonomy (closest match: "${matchedTemplateName}"), shown as a parent → child tree:
${renderSeed(seed)}

INBOX SIGNAL (aggregated from ${profile.eligibleThreadCount} relevant threads; counts in parentheses):
${renderTerms("Top sender domains", profile.senderDomains, 25)}
${renderTerms("Top sender names", profile.senderNames, 25)}
${renderTerms("Frequent subject keywords", profile.subjectKeywords, 40)}
${renderTerms("Gmail labels", profile.gmailLabels, 25)}

SENDER CLUSTERS (top senders and the themes they email about; use these to name specific sub-folders):
${renderClusters(profile.senderClusters)}

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
