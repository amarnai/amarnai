import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { AppDownloadBanner } from "@amarnai/ui";
import type { SupportedLocale } from "@amarnai/i18n";
import { initServerI18n } from "@/lib/i18n-server";
import { LinguiClientProvider } from "@/components/LinguiClientProvider";
import "./globals.css";

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
        <LinguiClientProvider locale={locale}>
          <AppDownloadBanner playStoreUrl={process.env.NEXT_PUBLIC_PLAY_STORE_URL} />
          {children}
        </LinguiClientProvider>
        {process.env.NEXT_PUBLIC_ANALYTICS_URL && (
          <Script src={process.env.NEXT_PUBLIC_ANALYTICS_URL} strategy="afterInteractive" />
        )}
      </body>
    </html>
  );
}
