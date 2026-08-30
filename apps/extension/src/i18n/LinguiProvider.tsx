import { useEffect, useState, type ReactNode } from "react";
import { I18nProvider } from "@lingui/react";
import {
  i18n,
  activateLocale,
  matchLocale,
  isSupportedLocale,
  type SupportedLocale,
} from "@aziru/i18n";

// Match the browser's languages to a supported locale, for use before the
// workspace locale is known.
export function resolveBrowserLocale(): SupportedLocale {
  return matchLocale([...navigator.languages]);
}

/**
 * Activates the active locale and provides the Lingui context to the panel.
 *
 * Unlike mobile (Metro can't dynamic-import, so it uses a static require map),
 * Vite/Rollup handles the template-literal dynamic import in @aziru/i18n's
 * loadCatalog, so we use the shared async `activateLocale`. I18nProvider needs
 * an activated i18n to hand down context, so children are withheld until the
 * first activation resolves. If a catalog fails to load (e.g. not yet compiled)
 * we still activate an empty English catalog so strings fall back to their
 * source text rather than crashing.
 */
export function LinguiProvider({
  locale,
  children,
}: {
  locale: SupportedLocale | null;
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const target: SupportedLocale =
    locale && isSupportedLocale(locale) ? locale : resolveBrowserLocale();

  useEffect(() => {
    let cancelled = false;
    activateLocale(target)
      .catch(() => {
        // Catalog missing/failed — activate English source fallback so the
        // provider still yields a valid context.
        i18n.loadAndActivate({ locale: "en", messages: {} });
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [target]);

  if (!ready) return null;
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}
