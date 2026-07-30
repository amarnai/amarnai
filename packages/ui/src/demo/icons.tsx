/**
 * Glyphs used by the shared product demos. They live beside the demo
 * components rather than in src/icons because they are sized and stroked for
 * the demo chrome specifically, and both the landing page and the extension's
 * first-run tab render them through those components.
 */

export function FolderIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M1 3 2.4 1.6h2.2L5.9 3H11a.8.8 0 0 1 .8.8V9a.8.8 0 0 1-.8.8H1A.8.8 0 0 1 .2 9V3Z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Matches the "Generate from inbox" sparkle used in the web app's
// GenerateFromInboxButton so the demo reads as the same action.
export function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M3 1.5L3.7 3.3L5.5 4L3.7 4.7L3 6.5L2.3 4.7L0.5 4L2.3 3.3ZM9.5 5L10.6 7.9L13.5 9L10.6 10.1L9.5 13L8.4 10.1L5.5 9L8.4 7.9Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Official multicolor Gmail envelope glyph, shown beside the "Gmail" wordmark
// in the mock inbox so the demo pane reads as the real product.
export function GmailLogoIcon() {
  return (
    <svg width="18" height="14" viewBox="0 0 52 40" fill="none" aria-hidden>
      <path d="M3.5 40h8V20.5L0 11.4v25.1C0 38.4 1.6 40 3.5 40z" fill="#4285F4" />
      <path d="M40.5 40h8c1.9 0 3.5-1.6 3.5-3.5V11.4L40.5 20.5V40z" fill="#34A853" />
      <path d="M40.5 3.5V20.5L52 11.4V5.2c0-5.7-6.5-9-11.1-5.5L40.5 3.5z" fill="#FBBC04" />
      <path d="M11.5 20.5V3.5L26 14.4 40.5 3.5V20.5L26 31.4z" fill="#EA4335" />
      <path d="M0 5.2v6.2l11.5 9.1V3.5L11.1-.3C6.5-3.3 0-.5 0 5.2z" fill="#C5221F" />
    </svg>
  );
}
