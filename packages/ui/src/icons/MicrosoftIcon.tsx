export interface MicrosoftIconProps {
  /**
   * "color" — the four-square Microsoft logo in its brand colors, for the
   * neutral/white sign-in button (Microsoft's own branding guidance).
   * "mono" — the same four squares in `currentColor`, for colored surfaces.
   */
  variant?: "color" | "mono";
  size?: number;
  className?: string;
}

// The Microsoft corporate mark (four squares), NOT the Outlook product mark:
// identity buttons carry the company logo, while OutlookIcon stands for the
// mailbox being connected. Both exist on purpose — do not swap one for the other.
const SQUARES = [
  { x: 1, y: 1, fill: "#F25022" },
  { x: 12.5, y: 1, fill: "#7FBA00" },
  { x: 1, y: 12.5, fill: "#00A4EF" },
  { x: 12.5, y: 12.5, fill: "#FFB900" },
] as const;

export function MicrosoftIcon({ variant = "color", size = 18, className }: MicrosoftIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      {SQUARES.map((square) => (
        <rect
          key={`${square.x}-${square.y}`}
          x={square.x}
          y={square.y}
          width="10.5"
          height="10.5"
          fill={variant === "mono" ? "currentColor" : square.fill}
        />
      ))}
    </svg>
  );
}
