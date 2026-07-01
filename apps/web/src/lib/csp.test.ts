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
