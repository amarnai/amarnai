import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { AppDownloadBanner, ThemeProvider, THEME_INIT_SCRIPT } from "@amarnai/ui";
import type { SupportedLocale } from "@amarnai/i18n";
import { initServerI18n } from "@/lib/i18n-server";
import { LinguiClientProvider } from "@/components/LinguiClientProvider";
import "./globals.css";
import "@amarnai/ui/theme/styles";

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

  return (
    <html lang={locale} className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        {/* Resolve and apply the theme before first paint to avoid a flash.
            Runs synchronously as the first thing in <body>. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
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
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  );
}
