import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Genizor — Open-source AI email triage",
  description:
    "Genizor is a self-hostable AI assistant layer for Gmail that sorts, drafts, and escalates email through a visual workflow you define.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
