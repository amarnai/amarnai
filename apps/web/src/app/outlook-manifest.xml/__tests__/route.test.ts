import { describe, it, expect, afterEach, vi } from "vitest";
import { GET } from "../route";

// The manifest is the contract with Outlook: a wrong URL or a changed Id breaks
// every installed add-in, and the permission level is a promise to the user
// about what Amarnai can do to their mailbox. All of that is asserted here.

afterEach(() => {
  vi.unstubAllEnvs();
});

function enable(baseUrl = "https://app.amarnai.com") {
  vi.stubEnv("OUTLOOK_ADDIN_ENABLED", "true");
  vi.stubEnv("APP_BASE_URL", baseUrl);
}

async function body(): Promise<string> {
  const res = await GET();
  return res.text();
}

describe("GET /outlook-manifest.xml", () => {
  it("404s when the add-in is not enabled for this deployment", async () => {
    vi.stubEnv("OUTLOOK_ADDIN_ENABLED", "");
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("serves XML with no caching", async () => {
    enable();
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("templates every URL from the deployment's own base", async () => {
    enable("https://mail.example.org");
    const xml = await body();

    expect(xml).toContain("<AppDomain>https://mail.example.org</AppDomain>");
    expect(xml).toContain(
      '<bt:Url id="paneUrl" DefaultValue="https://mail.example.org/outlook-panel" />',
    );
    expect(xml).not.toContain("app.amarnai.com");
  });

  it("strips a trailing slash so URLs never double up", async () => {
    enable("https://mail.example.org/");
    expect(await body()).not.toContain("https://mail.example.org//");
  });

  it("points the ribbon at the pane's draft deep link", async () => {
    enable();
    const xml = await body();
    expect(xml).toContain(
      '<bt:Url id="draftUrl" DefaultValue="https://app.amarnai.com/outlook-panel?focus=draft" />',
    );
    expect(xml).toContain("<SourceLocation resid=\"draftUrl\" />");
  });

  it("declares the read-form ribbon button", async () => {
    enable();
    const xml = await body();
    expect(xml).toContain('xsi:type="MessageReadCommandSurface"');
    expect(xml).toContain('<Control xsi:type="Button" id="amarnaiPanelButton">');
    expect(xml).toContain('<bt:String id="panelLabel" DefaultValue="Amarnai" />');
  });

  it("opens the task pane rather than running a headless function", async () => {
    enable();
    const xml = await body();
    expect(xml).toContain('<Action xsi:type="ShowTaskpane">');
    expect(xml).not.toContain("ExecuteFunction");
  });

  it("supports pinning so the pane survives switching messages", async () => {
    enable();
    expect(await body()).toContain("<SupportsPinning>true</SupportsPinning>");
  });

  it("requests ReadItem and nothing more", async () => {
    enable();
    const xml = await body();
    expect(xml).toContain("<Permissions>ReadItem</Permissions>");
    // ReadWriteMailbox would let the add-in send; Amarnai must never be able to.
    expect(xml).not.toContain("ReadWriteMailbox");
    expect(xml).not.toContain("ReadWriteItem");
  });

  it("keeps a stable default add-in Id — changing it orphans every install", async () => {
    enable();
    expect(await body()).toContain("<Id>6f3a5b1e-9c24-4a7d-8f16-2b8d4e0c93a1</Id>");
  });

  it("lets a deployment claim its own Id, so two installs can coexist", async () => {
    enable();
    vi.stubEnv("OUTLOOK_ADDIN_ID", "0f1e2d3c-4b5a-4968-8776-65544332211f");
    const xml = await body();
    expect(xml).toContain("<Id>0f1e2d3c-4b5a-4968-8776-65544332211f</Id>");
    expect(xml).not.toContain("6f3a5b1e-9c24-4a7d-8f16-2b8d4e0c93a1");
  });

  it("falls back to the default when the override is blank", async () => {
    enable();
    vi.stubEnv("OUTLOOK_ADDIN_ID", "   ");
    expect(await body()).toContain("<Id>6f3a5b1e-9c24-4a7d-8f16-2b8d4e0c93a1</Id>");
  });

  it("500s on a malformed Id rather than serving a manifest Outlook will reject", async () => {
    enable();
    vi.stubEnv("OUTLOOK_ADDIN_ID", "not-a-uuid");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET();
    expect(res.status).toBe(500);
  });

  it("requires the Mailbox 1.5 set that displayReplyForm and pinning need", async () => {
    enable();
    expect(await body()).toContain('<Set Name="Mailbox" MinVersion="1.5" />');
  });

  it("references icons at every size Outlook asks for", async () => {
    enable();
    const xml = await body();
    for (const size of [16, 32, 80]) {
      expect(xml).toContain(`https://app.amarnai.com/outlook/icon-${size}.png`);
    }
  });

  it("escapes a base URL that contains XML-significant characters", async () => {
    enable("https://example.org/a&b");
    const xml = await body();
    expect(xml).toContain("https://example.org/a&amp;b");
    expect(xml).not.toContain("/a&b");
  });
});
