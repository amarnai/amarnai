export interface OutlookIconProps {
  /**
   * "color" — the two-tone Outlook mark, for light/white surfaces.
   * "mono" — a single-color envelope that inherits `currentColor`, for colored
   * surfaces (e.g. a clay/accent connect CTA).
   */
  variant?: "color" | "mono";
  size?: number;
  className?: string;
}

export function OutlookIcon({ variant = "color", size = 18, className }: OutlookIconProps) {
  if (variant === "mono") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
        <path
          fill="currentColor"
          d="M13 4.5 22 6v12l-9 1.5V4.5zM2 6.75 11.5 5v14L2 17.25V6.75zm4.75 2.45c-1.63 0-2.66 1.15-2.66 2.89 0 1.69 1.02 2.86 2.6 2.86 1.64 0 2.66-1.18 2.66-2.9 0-1.7-1-2.85-2.6-2.85zm-.03 1.2c.8 0 1.27.65 1.27 1.65 0 1.04-.48 1.7-1.28 1.7-.79 0-1.29-.66-1.29-1.67 0-1.02.51-1.68 1.3-1.68z"
        />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M13 4.5 22 6v12l-9 1.5V4.5z" fill="#0F6CBD" />
      <path d="M2 6.75 11.5 5v14L2 17.25V6.75z" fill="#28A8EA" />
      <path
        d="M6.75 9.2c1.6 0 2.6 1.15 2.6 2.85 0 1.72-1.02 2.9-2.66 2.9-1.58 0-2.6-1.17-2.6-2.86 0-1.74 1.03-2.89 2.66-2.89zm-.03 1.2c-.79 0-1.3.66-1.3 1.68 0 1.01.5 1.67 1.29 1.67.8 0 1.28-.66 1.28-1.7 0-1-.47-1.65-1.27-1.65z"
        fill="#fff"
      />
    </svg>
  );
}
