import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppDownloadBanner } from "@amarnai/ui";
import "@amarnai/ui/emails/styles";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Amarnai — AI email triage",
  description:
    "Amarnai sorts your Gmail threads into folders you define, drafts replies for your approval, and shows its reasoning. Open-source and self-hostable.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <AppDownloadBanner playStoreUrl={process.env.NEXT_PUBLIC_PLAY_STORE_URL} />
        {children}
      </body>
    </html>
  );
}
