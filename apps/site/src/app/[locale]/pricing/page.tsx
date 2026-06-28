import type { Metadata } from "next";
import Link from "next/link";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { isSupportedLocale, SOURCE_LOCALE, type SupportedLocale } from "@amarnai/i18n";
import { initServerI18n } from "@/lib/i18n-server";
import { PricingPageClient } from "./PricingPageClient";
import styles from "./page.module.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const validLocale: SupportedLocale = isSupportedLocale(locale)
    ? locale
    : SOURCE_LOCALE;
  const i18n = await initServerI18n(validLocale);

  return {
    title: i18n._(msg`Pricing | Amarnai`),
    description: i18n._(
      msg`Simple per-workspace pricing. Start free, upgrade or create additional workspaces as you need.`
    ),
  };
}

export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const validLocale: SupportedLocale = isSupportedLocale(locale)
    ? locale
    : SOURCE_LOCALE;
  await initServerI18n(validLocale);

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
          <Trans>Priced per workspace. Sort as much as you like.</Trans>
        </h1>
        <p className={styles.subtitle}>
          <Trans>
            Every account starts with a free Personal workspace, no card
            required. Create more or upgrade whenever your needs grow.
          </Trans>
        </p>
      </div>
      <div className={styles.body}>
        <PricingPageClient />
      </div>
    </div>
  );
}
