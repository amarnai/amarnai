import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Amarnai",
  description: "Gmail-first AI email triage assistant",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
