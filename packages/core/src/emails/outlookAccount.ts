/**
 * Which kind of Microsoft account a mailbox belongs to, and the OWA host that
 * follows from it.
 *
 * Outlook on the web is two products on two hosts, and they are not
 * interchangeable: `outlook.office.com` is the work/school reading pane, gated by
 * an Entra app registration that refuses personal Microsoft accounts outright
 * ("AADSTS500200 ... personal Microsoft accounts are not supported"), while
 * personal accounts live on `outlook.live.com`. Sending an account to the wrong
 * one is a hard sign-in error, not a redirect, so any URL we build ourselves has
 * to know which kind of account it is for.
 *
 * Deep links built from Microsoft's own `webLink` are already host-correct and
 * need none of this; it is only the URLs Aziru invents (the mailbox itself)
 * that must choose.
 */

/** PERSONAL = a Microsoft account (MSA); ORGANIZATION = an Entra/work-school account. */
export type OutlookAccountType = "PERSONAL" | "ORGANIZATION";

/** Consumer OWA. `/mail/0/` is the canonical inbox URL for a personal account. */
export const OWA_PERSONAL_MAILBOX_URL = "https://outlook.live.com/mail/0/";

/** Work/school OWA. */
export const OWA_ORGANIZATION_MAILBOX_URL = "https://outlook.office.com/mail/";

/** Host that only ever serves personal mailboxes. */
const PERSONAL_OWA_HOST = "outlook.live.com";

/**
 * First label of the domains Microsoft issues personal accounts on. Matched on
 * the label rather than the full domain because every one of them has dozens of
 * country variants (hotmail.fr, live.co.uk, outlook.de ...).
 */
const PERSONAL_DOMAIN_LABELS = ["outlook", "hotmail", "live", "msn", "passport", "windowslive"];

/**
 * Guess the account type from the address alone.
 *
 * A fallback, used only while the stored type is unknown (a connection made
 * before we started recording it, and not yet backfilled). It is right for the
 * overwhelming majority of real accounts: work/school mailboxes never sit on a
 * Microsoft consumer domain. It is wrong for a personal account registered with
 * an outside address (a personal account on a Gmail or custom domain reads as
 * ORGANIZATION), which is exactly the case the stored type exists to fix.
 */
export function outlookAccountTypeFromEmail(
  accountEmail: string | null | undefined,
): OutlookAccountType | null {
  const domain = accountEmail?.split("@")[1]?.toLowerCase().trim();
  if (!domain) return null;
  const label = domain.split(".")[0] ?? "";
  return PERSONAL_DOMAIN_LABELS.includes(label) ? "PERSONAL" : "ORGANIZATION";
}

/**
 * Read the account type off a Graph `webLink`, whose host Microsoft has already
 * resolved for the mailbox that owns the message. This is what lets existing
 * connections be backfilled without a re-consent: any synced Outlook thread
 * carries the answer.
 *
 * Returns null for a host we do not recognise rather than guessing, so an
 * unfamiliar link cannot overwrite a known-good type.
 */
export function outlookAccountTypeFromWebLink(
  webLink: string | null | undefined,
): OutlookAccountType | null {
  if (!webLink) return null;
  let host: string;
  try {
    host = new URL(webLink).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === PERSONAL_OWA_HOST) return "PERSONAL";
  // office.com is the reading-pane host; office365.com is where Graph's webLinks
  // point before their redirect. Both are work/school only.
  if (host === "outlook.office.com" || host === "outlook.office365.com") return "ORGANIZATION";
  return null;
}

/**
 * The account type to build a URL from: the stored one when we have it, the
 * address-based guess otherwise, and work/school as the last resort (the
 * majority of Outlook connections, and the historical behaviour).
 */
export function resolveOutlookAccountType(
  accountType: OutlookAccountType | null | undefined,
  accountEmail: string | null | undefined,
): OutlookAccountType {
  return accountType ?? outlookAccountTypeFromEmail(accountEmail) ?? "ORGANIZATION";
}
