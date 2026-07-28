export interface ShieldCheckIconProps {
  size?: number;
  className?: string;
}

/**
 * Shield with a check, inheriting `currentColor`. Used wherever a security
 * review or certification is claimed (the landing trust strip, the extension's
 * first-run tab), so the same mark stands for the same thing everywhere.
 */
export function ShieldCheckIcon({ size = 15, className }: ShieldCheckIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 15 15"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M7.5 1.3 2 3.4v3.7c0 3.2 2.3 5.3 5.5 6.6 3.2-1.3 5.5-3.4 5.5-6.6V3.4L7.5 1.3Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M5.4 7.6 6.9 9.1 9.8 5.9"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
