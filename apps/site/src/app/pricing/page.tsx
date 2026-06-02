import type { Metadata } from "next";
import Link from "next/link";
import { PricingPlans } from "@amarnai/ui";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Pricing | Amarnai",
  description: "Simple per-workspace pricing. Start free, upgrade or create additional workspaces as you need.",
};

export default function PricingPage() {
  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <Link href="/" className={styles.backLink}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M11 7H3M6.5 3.5 3 7l3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back
        </Link>
        <h1 className={styles.title}>Priced per workspace. Sort as much as you like.</h1>
        <p className={styles.subtitle}>
          Every account starts with a free Personal workspace, no card required. Create more or upgrade whenever your needs grow.
        </p>
      </div>
      <div className={styles.body}>
        <PricingPlans />
      </div>
    </div>
  );
}
