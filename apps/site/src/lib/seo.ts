import type { Metadata } from "next";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import {
  SUPPORTED_LOCALES,
  SOURCE_LOCALE,
  type SupportedLocale,
} from "@amarnai/i18n";

export const BASE_URL = "https://amarnai.com";

// Canonical URL for a locale + path. The source locale is served at the bare
// domain so ranking signals consolidate there; other locales live at `/{locale}`.
export function localeUrl(locale: SupportedLocale, path = ""): string {
  const prefix = locale === SOURCE_LOCALE ? BASE_URL : `${BASE_URL}/${locale}`;
  return path ? `${prefix}/${path}` : prefix;
}

// hreflang `languages` map (plus x-default) for a given path, so each page
// advertises every translation to crawlers.
function languageAlternates(path = ""): Record<string, string> {
  return Object.fromEntries([
    ...SUPPORTED_LOCALES.map((l) => [l, localeUrl(l, path)]),
    ["x-default", localeUrl(SOURCE_LOCALE, path)],
  ]);
}

// Shared homepage SEO metadata, reused by both the localized homepage
// (`/{locale}`) and the bare-domain redirect entry point (`/`). The root `/`
// route is a client-side locale redirect, so without this it would be indexed
// with an empty title/description; giving it the same metadata as the source
// locale keeps the indexed snippet correct and consistent.
export function buildHomeMetadata(
  i18n: I18n,
  locale: SupportedLocale
): Metadata {
  // Visible browser-tab / search-result headline uses the human-facing brand
  // tagline. Machine-facing OG/Twitter titles keep the keyword-rich SEO phrasing.
  const title = i18n._(msg`Amarnai: AI Email Sorter for Gmail & Outlook`);
  const seoTitle = i18n._(msg`Amarnai: Sort emails your way`);
  const url = localeUrl(locale);

  return {
    title,
    description: i18n._(
      msg`Amarnai sorts your inbox into the folders you define, drafts replies for your approval, and explains every call so you reach inbox zero faster.`
    ),
    keywords: [
      i18n._(msg`ai email sorter`),
      i18n._(msg`gmail ai assistant`),
      i18n._(msg`outlook ai assistant`),
      i18n._(msg`email organizer`),
      i18n._(msg`inbox zero`),
      i18n._(msg`open source email ai`),
      i18n._(msg`self-hosted email assistant`),
    ],
    alternates: {
      canonical: url,
      languages: languageAlternates(),
    },
    openGraph: {
      title: seoTitle,
      description: i18n._(
        msg`Amarnai reads your inbox, sorts every thread into the folders you define, and drafts replies for your approval. Reach inbox zero without the busywork.`
      ),
      url,
      images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Amarnai" }],
    },
    twitter: {
      card: "summary_large_image",
      title: seoTitle,
      images: ["/og-image.png"],
    },
    robots: { index: true, follow: true },
  };
}

// Shared pricing-page SEO metadata, reused by the localized pricing page
// (`/{locale}/pricing`) and the bare `/pricing` redirect entry point.
export function buildPricingMetadata(
  i18n: I18n,
  locale: SupportedLocale
): Metadata {
  const title = i18n._(msg`Pricing | Amarnai`);
  const url = localeUrl(locale, "pricing");

  return {
    title,
    description: i18n._(
      msg`Simple per-workspace pricing. Start free, upgrade or create additional workspaces as you need.`
    ),
    alternates: {
      canonical: url,
      languages: languageAlternates("pricing"),
    },
    openGraph: { title, url, images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Amarnai" }] },
    twitter: { card: "summary_large_image", title, images: ["/og-image.png"] },
    robots: { index: true, follow: true },
  };
}
