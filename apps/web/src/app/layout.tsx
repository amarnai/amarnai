import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import Script from "next/script";
import { AppDownloadBanner, ThemeProvider, THEME_INIT_SCRIPT } from "@amarnai/ui";
import type { SupportedLocale } from "@amarnai/i18n";
import { initServerI18n } from "@/lib/i18n-server";
import { LinguiClientProvider } from "@/components/LinguiClientProvider";
import "./globals.css";
import "@amarnai/ui/theme/styles";
import "@amarnai/ui/tooltip/styles";
import "@amarnai/ui/switch/styles";
import "@amarnai/ui/taxonomy-editor/styles";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: {
    template: "%s | Amarnai",
    default: "Amarnai",
  },
  description: "Your AI email triage assistant.",
  applicationName: "Amarnai",
  metadataBase: new URL("https://app.amarnai.com"),
  robots: { index: false, follow: false },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Activate Lingui for any Server Component rendered in this request.
  const i18n = await initServerI18n();
  const locale = i18n.locale as SupportedLocale;

  // Per-request CSP nonce set by proxy.ts. Attached to the inline theme script (and
  // the analytics script) so they satisfy the nonce-based script-src policy.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang={locale} className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        {/* Resolve and apply the theme before first paint to avoid a flash.
            Runs synchronously as the first thing in <body>.
            suppressHydrationWarning: browsers blank the `nonce` attribute in the live
            DOM after applying CSP, so it never matches the server value at hydration. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <ThemeProvider>
          <LinguiClientProvider locale={locale}>
            <AppDownloadBanner playStoreUrl={process.env.NEXT_PUBLIC_PLAY_STORE_URL} />
            {children}
          </LinguiClientProvider>
        </ThemeProvider>
        {process.env.NEXT_PUBLIC_UMAMI_SRC && process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID && (
          <Script
            src={process.env.NEXT_PUBLIC_UMAMI_SRC}
            data-website-id={process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID}
            nonce={nonce}
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  );
}
