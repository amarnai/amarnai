import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Bundle Geist locally so the panel matches web/site. Next injects the
// --font-geist-* variables via next/font in those apps; here we ship the
// variable woff2 (normal-weight axis, subset via unicode-range) and map the
// variables to the fontsource families in globals.css.
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/geist-mono/wght.css";
import "./styles/globals.css";
import "@aziru/ui/theme/styles";
import "@aziru/ui/tooltip/styles";
import "@aziru/ui/switch/styles";
import "@aziru/ui/emails/styles";
import "@aziru/ui/plan-setup/styles";
import "@aziru/ui/upgrade/styles";
import "@aziru/ui/settings/styles";
import "@aziru/ui/taxonomy-editor/styles";
import { applyStoredThemeSync } from "@aziru/ui";
import { App } from "./App";

// Set data-theme from stored preference (or the OS) before React mounts, so the
// panel opens in the right theme with no light flash. ThemeProvider re-syncs
// from the same storage on mount.
applyStoredThemeSync();

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
