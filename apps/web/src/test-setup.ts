import "@testing-library/jest-dom/vitest";
import { i18n } from "@amarnai/i18n";

// Activate the source locale so Lingui macros render their English defaults.
// Tests assert on the English source text; an empty catalog falls back to it.
i18n.loadAndActivate({ locale: "en", messages: {} });
