import { notFound } from "next/navigation";
import { ThemeProvider, THEME_STORAGE_KEY } from "@aziru/ui";
import { SOURCE_LOCALE } from "@aziru/i18n";
import { initServerI18n } from "@/lib/i18n-server";
import { LinguiSiteProvider } from "@/app/LinguiSiteProvider";

/**
 * Server shell shared by the dev-only store-tile routes: 404s in production,
 * activates the source-locale catalog, and pins the theme to light before
 * first paint so captures are deterministic regardless of the capturing
 * machine's OS theme (change "light" to "dark" to proof a dark variant).
 */
export async function TileShell({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  const i18n = await initServerI18n(SOURCE_LOCALE);

  const pinTheme =
    `try{localStorage.setItem(${JSON.stringify(THEME_STORAGE_KEY)},"light")}catch{};` +
    `document.documentElement.dataset.theme="light";`;

  return (
    <ThemeProvider>
      <script dangerouslySetInnerHTML={{ __html: pinTheme }} />
      <LinguiSiteProvider locale={SOURCE_LOCALE} messages={i18n.messages}>
        {children}
      </LinguiSiteProvider>
    </ThemeProvider>
  );
}
