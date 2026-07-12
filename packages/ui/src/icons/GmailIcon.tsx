export interface GmailIconProps {
  /**
   * "color" — the multicolor Gmail envelope, for light/white surfaces.
   * "mono" — a single-color envelope that inherits `currentColor`, for colored
   * surfaces where the multicolor mark isn't appropriate.
   */
  variant?: "color" | "mono";
  size?: number;
  className?: string;
}

// The Gmail envelope mark. The "color" variant is Google's four-color logo; the
// "mono" variant is a single-color envelope silhouette (with the M valley cut
// out) so it reads as Gmail on colored surfaces.
export function GmailIcon({ variant = "color", size = 18, className }: GmailIconProps) {
  if (variant === "mono") {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden="true">
        <path
          fill="currentColor"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M6 9h36a3 3 0 0 1 3 3v24a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V12a3 3 0 0 1 3-3Zm-3 4.2L24 25.5 45 13.2V36H3V13.2Z"
        />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#4caf50" d="M45 16.2l-5 2.75-5 4.75L35 40h7c1.657 0 3-1.343 3-3V16.2z" />
      <path fill="#1e88e5" d="M3 16.2l3.614 1.71L13 23.7V40H6c-1.657 0-3-1.343-3-3V16.2z" />
      <polygon fill="#e53935" points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,31.95 35,23.7 36,17" />
      <path fill="#c62828" d="M3 12.298V16.2l10 7.5V11.2L9.876 8.859C9.132 8.301 8.228 8 7.298 8 4.924 8 3 9.924 3 12.298z" />
      <path fill="#fbc02d" d="M45 12.298V16.2l-10 7.5V11.2l3.124-2.341C38.868 8.301 39.772 8 40.702 8 43.076 8 45 9.924 45 12.298z" />
    </svg>
  );
}
