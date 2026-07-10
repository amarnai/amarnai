import Link from "next/link";
import { Trans } from "@lingui/react/macro";
import { PricingPageClient } from "./PricingPageClient";
import styles from "./PricingContent.module.css";

// Pricing page content, shared by the localized route (`/[locale]/pricing`) and
// the source-locale page served at the bare `/pricing` URL. The caller must
// activate server-side i18n for the target locale before rendering so the
// `<Trans>` macros resolve. The "Back" link is relative (`../`) so it lands on
// the correct home for either mount point (`/` or `/{locale}`).
export function PricingContent() {
  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <Link href="../" className={styles.backLink}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M11 7H3M6.5 3.5 3 7l3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <Trans>Back</Trans>
        </Link>
        <h1 className={styles.title}>
          <Trans>Priced per workspace. Clear plans, clear limits.</Trans>
        </h1>
        <p className={styles.subtitle}>
          <Trans>
            Every account starts with a free workspace, no card required.
            Create more or upgrade whenever your needs grow.
          </Trans>
        </p>
      </div>
      <div className={styles.body}>
        <PricingPageClient />
      </div>
    </div>
  );
}
