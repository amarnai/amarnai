// Inbox identity normalization for usage metering and shared-mailbox pooling.
//
// Cost meters key on the connected Gmail inbox, not the workspace/user, so that
// a reset, an extra workspace, or an extra account cannot mint a fresh budget for
// the same real inbox. The key must therefore collapse to one value for one inbox.
//
// "+tag" sub-addressing is honored by virtually every provider (Gmail, Outlook.com,
// Yahoo, iCloud, most custom domains): ben+anything@example.com delivers to the same
// mailbox as ben@example.com. As an abuse anchor we collapse it for ALL domains, so
// the same local part with different "+tags" counts as one identity and a user cannot
// farm unlimited trials (or fresh usage budgets) by varying the tag. This deliberately
// also pools two genuinely distinct "+"-addresses into one bucket, which is rare and
// the conservative choice for an anti-abuse key.
//
// Dot-insensitivity, by contrast, is a Gmail-only quirk: ben@gmail.com and
// b.e.n@gmail.com are the same Google account, but on every other domain a dot is a
// significant character, so dot-collapsing stays gated to gmail.com / googlemail.com.

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * Normalize a raw email address into the stable inbox key used by the usage meter,
 * sibling-connection pooling, and the durable trial-claim anchor. Strips "+tag"
 * sub-addressing for all domains and additionally collapses dots on Gmail.
 * Idempotent. Inputs without a single "@" are
 * lowercased/trimmed and returned as-is (defensive; real connections always have
 * a valid address from OAuth).
 */
export function normalizeInboxKey(rawAddress: string): string {
  const trimmed = rawAddress.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return trimmed;

  let local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);

  // Strip "+tag" sub-addressing for every provider (see file header): the tag never
  // changes which mailbox a message lands in, so it must not change the identity key.
  const plus = local.indexOf("+");
  if (plus !== -1) local = local.slice(0, plus);

  if (GMAIL_DOMAINS.has(domain)) {
    // Gmail also ignores dots, and googlemail.com is an alias of gmail.com.
    local = local.replace(/\./g, "");
    return `${local}@gmail.com`;
  }

  // Other providers treat dots literally, so beyond the +tag strip and lowercase/trim
  // above we leave the address alone (b.e.n@acme.com stays distinct from ben@acme.com).
  return `${local}@${domain}`;
}
