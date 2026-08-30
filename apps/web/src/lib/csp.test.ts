import { afterEach, describe, expect, it, vi } from "vitest";
import { buildContentSecurityPolicy, cspHeaderName, generateCspNonce } from "./csp";

function directive(csp: string, name: string): string | undefined {
  return csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
}

describe("buildContentSecurityPolicy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("makes script-src nonce-based with strict-dynamic", () => {
    const csp = buildContentSecurityPolicy("abc123");
    const scriptSrc = directive(csp, "script-src")!;
    expect(scriptSrc).toContain("'nonce-abc123'");
    expect(scriptSrc).toContain("'strict-dynamic'");
    // No blanket 'unsafe-inline' for scripts: that would defeat the XSS defence.
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("locks down the dangerous baseline directives", () => {
    const csp = buildContentSecurityPolicy("n");
    expect(directive(csp, "default-src")).toBe("default-src 'self'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
  });

  it("adds unsafe-eval and ws for the dev toolchain, and upgrade-insecure only in prod", () => {
    vi.stubEnv("NODE_ENV", "development");
    const dev = buildContentSecurityPolicy("n");
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "connect-src")).toContain("ws:");
    expect(directive(dev, "upgrade-insecure-requests")).toBeUndefined();

    vi.stubEnv("NODE_ENV", "production");
    const prod = buildContentSecurityPolicy("n");
    expect(directive(prod, "script-src")).not.toContain("'unsafe-eval'");
    expect(directive(prod, "upgrade-insecure-requests")).toBe("upgrade-insecure-requests");
  });

  it("appends report-uri only when a collector is configured", () => {
    expect(buildContentSecurityPolicy("n")).not.toContain("report-uri");

    vi.stubEnv("CSP_REPORT_URI", "/api/csp-report");
    expect(directive(buildContentSecurityPolicy("n"), "report-uri")).toBe(
      "report-uri /api/csp-report",
    );
  });

  it("allows the analytics origin in script-src and connect-src when configured", () => {
    vi.stubEnv("NEXT_PUBLIC_UMAMI_SRC", "https://analytics.example.com/script.js");
    const csp = buildContentSecurityPolicy("n");
    expect(directive(csp, "script-src")).toContain("https://analytics.example.com");
    expect(directive(csp, "connect-src")).toContain("https://analytics.example.com");
  });

  it("ignores a malformed analytics URL rather than emitting a broken directive", () => {
    vi.stubEnv("NEXT_PUBLIC_UMAMI_SRC", "not a url");
    const csp = buildContentSecurityPolicy("n");
    expect(directive(csp, "connect-src")).not.toContain("not a url");
    expect(directive(csp, "script-src")).not.toContain("not a url");
  });
});

describe("generateCspNonce", () => {
  it("produces distinct base64 nonces", () => {
    const a = generateCspNonce();
    const b = generateCspNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});

// The Outlook task pane is the only page Amarnai lets anyone frame, and the only
// one that loads a third-party script. Every assertion here is about keeping that
// exception to exactly one path: a leak would make the whole app clickjackable.
describe("buildContentSecurityPolicy — Outlook task pane exception", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function enableAddin() {
    vi.stubEnv("OUTLOOK_ADDIN_ENABLED", "true");
  }

  it("lets Outlook frame the pane, and names the hosts rather than allowing any", () => {
    enableAddin();
    const frameAncestors = directive(
      buildContentSecurityPolicy("n", "/outlook-panel"),
      "frame-ancestors",
    )!;
    expect(frameAncestors).toContain("https://outlook.office.com");
    expect(frameAncestors).toContain("https://outlook.office365.com");
    expect(frameAncestors).toContain("https://outlook.live.com");
    expect(frameAncestors).toContain("https://*.officeapps.live.com");
    expect(frameAncestors).not.toContain("*;");
    expect(frameAncestors).not.toContain("'self'");
  });

  it("allows office.js and the API only on the pane", () => {
    enableAddin();
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.aziru.email");
    const pane = buildContentSecurityPolicy("n", "/outlook-panel");
    expect(directive(pane, "script-src")).toContain("https://appsforoffice.microsoft.com");
    expect(directive(pane, "connect-src")).toContain("https://api.aziru.email");

    const other = buildContentSecurityPolicy("n", "/emails");
    expect(directive(other, "script-src")).not.toContain("appsforoffice");
    expect(directive(other, "connect-src")).not.toContain("api.aziru.email");
  });

  it("keeps every other route unframable", () => {
    enableAddin();
    for (const path of ["/", "/emails", "/settings", "/sign-in", undefined]) {
      expect(directive(buildContentSecurityPolicy("n", path), "frame-ancestors")).toBe(
        "frame-ancestors 'none'",
      );
    }
  });

  it("does not let a lookalike path inherit the exception", () => {
    enableAddin();
    for (const path of ["/outlook-panels", "/outlook-panel-x", "/x/outlook-panel"]) {
      expect(directive(buildContentSecurityPolicy("n", path), "frame-ancestors")).toBe(
        "frame-ancestors 'none'",
      );
    }
  });

  it("still applies to the pane's own sub-paths", () => {
    enableAddin();
    expect(
      directive(buildContentSecurityPolicy("n", "/outlook-panel/auth"), "frame-ancestors"),
    ).toContain("https://outlook.office.com");
  });

  it("refuses to widen anything when the add-in is not enabled", () => {
    vi.stubEnv("OUTLOOK_ADDIN_ENABLED", "");
    const csp = buildContentSecurityPolicy("n", "/outlook-panel");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "script-src")).not.toContain("appsforoffice");
  });
});

describe("cspHeaderName", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("enforces by default", () => {
    expect(cspHeaderName()).toBe("Content-Security-Policy");
  });

  it("switches to report-only when CSP_REPORT_ONLY is 'true'", () => {
    vi.stubEnv("CSP_REPORT_ONLY", "true");
    expect(cspHeaderName()).toBe("Content-Security-Policy-Report-Only");
  });

  it("treats any other value as enforce", () => {
    vi.stubEnv("CSP_REPORT_ONLY", "1");
    expect(cspHeaderName()).toBe("Content-Security-Policy");
  });
});
