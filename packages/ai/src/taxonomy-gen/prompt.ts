import {
  taxonomySizeBandFor,
  type InboxProfile,
  type SenderCluster,
  type TaxonomySizeBand,
  type TaxonomyTransferFile,
} from "@aziru/shared";

// Builds the LLM messages that personalize a seed template into a taxonomy that
// fits a specific inbox. The model receives only aggregated, body-free signal
// (sender domains, sender names, subject keywords, Gmail labels) plus the seed.

function buildSystemPrompt(targetLanguage: string, band: TaxonomySizeBand): string {
  return `You are an email-organization assistant. Personalize a STARTING taxonomy of folders to fit a user's inbox, based on aggregated signal about who emails them and about what.

You output a single JSON object describing a folder tree. The shape is exactly:
{
  "aziruTaxonomyVersion": 1,
  "exportedAt": "<ISO 8601 timestamp>",
  "nodes": [ { "ref": "<unique string>", "name": "<folder name>", "description": "<what belongs here>", "isRoot": <boolean>, "isCatchAll": <boolean, optional>, "instructions": null, "draftPrompt": null, "examples": [], "positionX": <number>, "positionY": <number> } ],
  "edges": [
    { "sourceRef": "root", "targetRef": "<top-level ref>" },
    { "sourceRef": "<top-level ref>", "targetRef": "<sub-folder ref>" }
  ]
}

HARD RULES (violations are rejected):
- LANGUAGE: Write every "name" and "description" value in ${targetLanguage}. Do NOT use English unless ${targetLanguage} is English. The single root node must still be named exactly "Inbox" (do not translate it). "ref" values MUST stay lowercase ASCII slugs (a-z, 0-9, hyphens) and must NEVER be translated — they are internal identifiers, never shown to the user.
- Exactly ONE root node with "isRoot": true and "name": "Inbox". Every other node has "isRoot": false.
- It must be a TREE: every non-root node is the target of EXACTLY ONE edge. No cycles. No orphans. The root is never an edge target.
- Folder names: plain text (no HTML), must contain a letter or digit. In Latin scripts use 3 to 40 characters; in Chinese or Japanese a natural 2-character name is fine.
- Every non-root folder needs a plain-text "description", at most 300 characters, DIFFERENT from its name. In Latin scripts make it at least 30 characters; in Chinese or Japanese aim for a full sentence (about 12 characters or more).
- Keep ONE catch-all leaf (set "isCatchAll": true on it, e.g. a folder meaning "Updates" or "Other") so automated/bulk mail has a home. Give it a normal description.
- "instructions" and "draftPrompt" must be null; "examples" must be []. Set sensible "positionX"/"positionY" numbers (you may copy the seed's layout).

GUIDANCE:
- Build a TWO-LEVEL tree. Top level: ${band.minTopLevel} to ${band.maxTopLevel} broad categories (the major areas or relationships in this inbox). Under each top-level category, add 2 to 4 sub-folders ONLY when the inbox shows distinct recurring themes within it. A category with a single theme should BE a single leaf — never nest one lone sub-folder under a category (no "Recruiting > Job Applications"; just "Job Search").
- Do NOT nest deeper than two levels below "Inbox".
- Start from the SEED taxonomy, which is already two-level. Keep the parts that fit, rename ones that nearly fit, add sub-folders for clear recurring themes in the signal, and drop branches with no support in the inbox. The seed is shown in English; translate the parts you keep into ${targetLanguage}.
- Name every folder after a TOPIC or ACTIVITY — what the mail is about, or what the user does with it — NOT after a sender, company, brand, or product. The sender clusters are EVIDENCE of which themes recur; use them to decide which themes exist, never as folder names (e.g. "Acme Corp" or "GitHub" as a folder is WRONG — use "Client Work", "Code Reviews"). Prefer a broader theme that spans several senders over one folder per sender or per tool. Only create a folder for a theme the user actively engages with, or that the user must act on.
- This inbox's variety supports about ${band.minLeaves} to ${band.maxLeaves} leaf folders total — aim for that range. Every folder MUST map to a real theme in the signal: if you cannot reach ${band.minLeaves} well-supported folders, produce fewer rather than inventing generic buckets. When in doubt, merge rather than split — a few well-supported folders beat many thin ones.
- A high-volume stream from a SINGLE company that is automated or transactional (account notifications, security or sign-in alerts, OAuth or verification messages, receipts, order, subscription, or service updates, a single service's account notifications such as a streaming or SaaS account) belongs in the catch-all leaf, NOT its own folder, even when it is frequent in the signal. Do NOT invent folders to capture this kind of noise; that is what the catch-all leaf is for.
- Output ONLY the JSON object. No prose, no markdown fences.`;
}

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
  targetLanguage: string,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const user = `SEED taxonomy (closest match: "${matchedTemplateName}"), shown as a parent → child tree:
${renderSeed(seed)}

INBOX SIGNAL (aggregated from ${profile.eligibleThreadCount} relevant threads; counts in parentheses):
${renderTerms("Top sender domains", profile.senderDomains, 25)}
${renderTerms("Top sender names", profile.senderNames, 25)}
${renderTerms("Frequent subject keywords", profile.subjectKeywords, 40)}
${renderTerms("Gmail labels", profile.gmailLabels, 25)}

SENDER CLUSTERS (top senders and the themes they email about — use these as EVIDENCE of which themes recur, NOT as folder names; name folders by topic or activity, not by sender):
${renderClusters(profile.senderClusters)}

Produce the personalized taxonomy JSON now, with all names and descriptions in ${targetLanguage}.`;

  return [
    { role: "system", content: buildSystemPrompt(targetLanguage, taxonomySizeBandFor(profile)) },
    { role: "user", content: user },
  ];
}

/** Build a one-shot repair message appending the validation error. */
export function buildRepairMessage(
  error: string,
  targetLanguage: string,
): { role: "user"; content: string } {
  return {
    role: "user",
    content: `The taxonomy you returned was invalid: ${error}\n\nReturn a corrected JSON object that fixes this and obeys all HARD RULES. Keep all names and descriptions in ${targetLanguage}; keep refs as lowercase ASCII slugs. Output ONLY the JSON.`,
  };
}
