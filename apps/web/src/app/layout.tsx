import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
        {process.env.NEXT_PUBLIC_ANALYTICS_URL && (
          <Script src={process.env.NEXT_PUBLIC_ANALYTICS_URL} strategy="afterInteractive" />
        )}
      </body>
    </html>
  );
}
