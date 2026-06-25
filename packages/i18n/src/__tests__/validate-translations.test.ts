import { describe, it, expect } from "vitest";
import {
  validateTranslations,
  extractPlaceholders,
} from "../validate-translations.js";

describe("extractPlaceholders", () => {
  it("extracts simple placeholders", () => {
    const result = extractPlaceholders("Hello {name}, you have {count} messages.");
    expect(result).toEqual(new Set(["{name}", "{count}"]));
  });

  it("extracts ICU plural placeholders by variable name", () => {
    const result = extractPlaceholders(
      "{count, plural, one {# item} other {# items}}"
    );
    expect(result).toEqual(new Set(["{count}"]));
  });

  it("returns empty set for strings with no placeholders", () => {
    expect(extractPlaceholders("Hello world")).toEqual(new Set());
  });
});

describe("validateTranslations", () => {
  const entries = [
    { msgid: "Sign in" },
    { msgid: "Hello {name}" },
  ];

  it("accepts a valid translation map", () => {
    const result = validateTranslations(
      { "Sign in": "Se connecter", "Hello {name}": "Bonjour {name}" },
      entries
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data["Sign in"]).toBe("Se connecter");
    }
  });

  it("rejects when a key is missing", () => {
    const result = validateTranslations({ "Sign in": "Se connecter" }, entries);
    expect(result.ok).toBe(false);
  });

  it("rejects when an extra key is present", () => {
    const result = validateTranslations(
      {
        "Sign in": "Se connecter",
        "Hello {name}": "Bonjour {name}",
        "Extra key": "injected",
      },
      entries
    );
    expect(result.ok).toBe(false);
  });

  it("rejects when an ICU placeholder is dropped in translation", () => {
    const result = validateTranslations(
      { "Sign in": "Se connecter", "Hello {name}": "Bonjour" },
      entries
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("{name}");
    }
  });

  it("rejects empty string translations", () => {
    const result = validateTranslations(
      { "Sign in": "", "Hello {name}": "Bonjour {name}" },
      entries
    );
    expect(result.ok).toBe(false);
  });

  it("rejects non-object response", () => {
    const result = validateTranslations("not an object", entries);
    expect(result.ok).toBe(false);
  });

  it("accepts when source has no placeholders and translation has none", () => {
    const result = validateTranslations(
      { "Sign in": "Anmelden", "Hello {name}": "Hallo {name}" },
      entries
    );
    expect(result.ok).toBe(true);
  });
});
