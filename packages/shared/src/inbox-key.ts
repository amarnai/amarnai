// Inbox identity normalization for usage metering and shared-mailbox pooling.
//
// Cost meters key on the connected Gmail inbox, not the workspace/user, so that
// a reset, an extra workspace, or an extra account cannot mint a fresh budget for
// the same real inbox. The key must therefore collapse to one value for one inbox.
//
// Consumer Gmail ignores dots and "+tag" suffixes: ben@gmail.com, b.e.n@gmail.com,
// and ben+anything@gmail.com all deliver to one mailbox, and Google treats them as
// one account. We canonicalize those so they share a meter. This is ONLY safe for
// gmail.com / googlemail.com — on custom domains a dot is significant, so we leave
// those addresses alone apart from lowercasing.

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * Normalize a raw email address into the stable inbox key used by the usage meter
 * and sibling-connection pooling. Idempotent. Inputs without a single "@" are
 * lowercased/trimmed and returned as-is (defensive; real connections always have
 * a valid address from OAuth).
 */
export function normalizeInboxKey(rawAddress: string): string {
  const trimmed = rawAddress.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return trimmed;

  let local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);

  if (GMAIL_DOMAINS.has(domain)) {
    const plus = local.indexOf("+");
    if (plus !== -1) local = local.slice(0, plus);
    local = local.replace(/\./g, "");
    return `${local}@gmail.com`;
  }

  // Every other provider (Outlook/outlook.com, custom domains, …) treats dots and
  // the local part literally, so we pass the address through unchanged apart from
  // the lowercase/trim above. Only the Gmail branch collapses dots and +tags.
  return `${local}@${domain}`;
}
