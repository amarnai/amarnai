import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Same locally bundled Geist as the panel (see src/main.tsx). Bundled rather
// than linked from a CDN: this document renders inside the user's mail page, and
// a webfont request from there would be a third-party call on that page.
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/geist-mono/wght.css";
import "../styles/tokens.css";
import "@amarnai/ui/emails/styles";
import "@amarnai/panel/styles";
import "@amarnai/ui/theme/styles";
import { applyStoredThemeSync, ThemeProvider } from "@amarnai/ui";
import { LinguiProvider } from "../i18n/LinguiProvider";
import { InjectedApp } from "./InjectedApp";

// The panel iframe injected into the mail page: Gmail's sidebar, or OWA's
// drawer. One document for both — which embedder it is arrives as a query
// parameter and is read by panelHost.ts, the only place the two differ.
//
// A separate HTML entry from the side panel (index.html) and the welcome tab,
// because it is a different document with a different host — but the same
// bundle, so shared chunks dedupe between the three.

// Theme comes from the same storage the side panel writes, so the injected panel
// matches whatever the user chose there rather than guessing from the mail app's
// theme (which is not readable from this frame anyway).
applyStoredThemeSync();

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");
createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      {/* No workspace locale here: the panel resolves its workspace only after
          the mail page reports a conversation, so the browser's languages are
          the best available signal at mount. */}
      <LinguiProvider locale={null}>
        <InjectedApp />
      </LinguiProvider>
    </ThemeProvider>
  </StrictMode>,
);
