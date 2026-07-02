import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Bundle Geist locally so the panel matches web/site. Next injects the
// --font-geist-* variables via next/font in those apps; here we ship the
// variable woff2 (normal-weight axis, subset via unicode-range) and map the
// variables to the fontsource families in globals.css.
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/geist-mono/wght.css";
import "./styles/globals.css";
import "@amarnai/ui/theme/styles";
import "@amarnai/ui/emails/styles";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
