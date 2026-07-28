import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Same locally bundled Geist as the panel (see src/main.tsx).
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/geist-mono/wght.css";
// The carousel renders the same demos as the landing page, so it needs their
// styles; welcome.css comes last so the page can size them into its layout.
import "@amarnai/ui/emails/styles";
import "@amarnai/ui/demo/styles";
import "./welcome.css";
import "@amarnai/ui/theme/styles";
import { applyStoredThemeSync, ThemeProvider } from "@amarnai/ui";
import { LinguiProvider } from "../i18n/LinguiProvider";
import { WelcomeApp } from "./WelcomeApp";

// This page opens on install, before anyone has signed in, so there is no
// workspace locale yet: LinguiProvider falls back to the browser's languages.
// Theme is read from the same storage the panel uses (empty on a fresh install,
// which resolves to the OS preference).
applyStoredThemeSync();

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");
createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <LinguiProvider locale={null}>
        <WelcomeApp />
      </LinguiProvider>
    </ThemeProvider>
  </StrictMode>,
);
