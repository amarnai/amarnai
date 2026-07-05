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

// Browser-extension puzzle piece, used on the "Add to Chrome/Firefox" CTA.
// Matches Chrome's extensions toolbar glyph (Material "extension" icon).
export function PuzzlePieceIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z" />
    </svg>
  );
}

// Official multicolor Gmail envelope glyph, shown beside the "Gmail" wordmark
// in the mock inbox so the demo pane reads as the real product.
export function GmailLogoIcon() {
  return (
    <svg width="18" height="14" viewBox="0 0 52 40" fill="none" aria-hidden>
      <path
        d="M3.5 40h8V20.5L0 11.4v25.1C0 38.4 1.6 40 3.5 40z"
        fill="#4285F4"
      />
      <path
        d="M40.5 40h8c1.9 0 3.5-1.6 3.5-3.5V11.4L40.5 20.5V40z"
        fill="#34A853"
      />
      <path
        d="M40.5 3.5V20.5L52 11.4V5.2c0-5.7-6.5-9-11.1-5.5L40.5 3.5z"
        fill="#FBBC04"
      />
      <path d="M11.5 20.5V3.5L26 14.4 40.5 3.5V20.5L26 31.4z" fill="#EA4335" />
      <path
        d="M0 5.2v6.2l11.5 9.1V3.5L11.1-.3C6.5-3.3 0-.5 0 5.2z"
        fill="#C5221F"
      />
    </svg>
  );
}

// Matches the "Generate from inbox" sparkle used in the web app's
// GenerateFromInboxButton so the marketing demo reads as the same action.
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
