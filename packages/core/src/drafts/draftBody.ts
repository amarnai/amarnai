// Plain-text draft body → HTML for insertion into a provider's compose.
//
// The model returns plain text (packages/ai returns { subject, body } with no
// HTML variant), but both insertion targets take HTML: InboxSDK's
// insertHTMLIntoBodyAtCursor and Office's displayReplyForm({ htmlBody }).
// Shared so the two providers can never render the same draft differently.

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escape before any markup is added. The body is model output inserted into a
 * live compose in the user's mailbox, so it is treated as untrusted text: a
 * draft containing `<script>` or a stray `<` must appear as characters, never as
 * markup.
 */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

/**
 * Blank-line-separated blocks become paragraphs; single newlines inside a block
 * become <br>. Trailing whitespace is dropped so the insertion point sits
 * directly above the quoted trail rather than after a run of empty lines.
 *
 * Returns "" for an empty or whitespace-only body — callers treat that as
 * nothing to insert rather than writing an empty paragraph into the compose.
 */
export function draftBodyToHtml(body: string): string {
  const normalized = body.replace(/\r\n?/g, "\n").trim();
  if (normalized === "") return "";

  return normalized
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).split("\n").join("<br>")}</p>`)
    .join("");
}
