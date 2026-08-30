import type { ReactElement, ReactNode } from "react";
import {
  render as rtlRender,
  type RenderOptions,
} from "@testing-library/react";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@aziru/i18n";

// Components wrapped with Lingui macros call useLingui()/<Trans>, which require
// an I18nProvider in the React tree. Wrap every render so tests don't each have
// to provide one. The source-locale catalog is activated in test-setup, so
// <Trans> renders the English default text the tests assert on.
function Wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

function render(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return rtlRender(ui, { wrapper: Wrapper, ...options });
}

// Re-export the rest of Testing Library, overriding render with the wrapped one.
export * from "@testing-library/react";
export { render };
