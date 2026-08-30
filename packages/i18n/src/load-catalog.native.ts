import { type Messages } from "@lingui/core";
import { type SupportedLocale } from "./locales.js";

// React Native / Metro cannot transform the template-literal dynamic import used
// by the web loader (load-catalog.ts). Mobile bundles every compiled catalog
// statically and switches them at runtime via registerMobileMessages() and
// activateLocaleMobile() (see i18n.ts), so these loaders are never called on
// native. They exist only so the shared @aziru/i18n barrel resolves on Metro.

export async function loadCatalog(_locale: SupportedLocale): Promise<Messages> {
  throw new Error(
    "loadCatalog is not supported on React Native; use activateLocaleMobile()"
  );
}

export async function activateLocale(_locale: SupportedLocale): Promise<void> {
  throw new Error(
    "activateLocale is not supported on React Native; use activateLocaleMobile()"
  );
}
