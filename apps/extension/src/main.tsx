import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
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
