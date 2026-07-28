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
