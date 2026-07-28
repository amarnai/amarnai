// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { ApiClient, TaxonomyNode, TaxonomyEdge } from "@amarnai/api-client";
import { TaxonomyEditor, type TaxonomyEditorProps } from "./TaxonomyEditor.js";
import { ThemeProvider } from "../theme/ThemeProvider.js";

// ReactFlow cannot measure in jsdom, so the canvas is stubbed. What matters here
// is which calls each action makes and what the seams do, not how the graph
// paints. Node/edge clicks are exposed as buttons so the panels can be opened.
vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@xyflow/react");
  return {
    ...actual,
    ReactFlow: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="canvas">{children}</div>
    ),
    Background: () => null,
    Controls: () => null,
    ReactFlowProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    useReactFlow: () => ({ screenToFlowPosition: (p: unknown) => p }),
  };
});

// jsdom ships no matchMedia, which ThemeProvider consults for the system theme.
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
}));

i18n.load("en", {});
i18n.activate("en");
afterEach(cleanup);

function node(overrides: Partial<TaxonomyNode> & { id: string }): TaxonomyNode {
  return {
    name: "Folder",
    description: "Things that belong in this folder, from various senders.",
    instructions: null,
    draftPrompt: null,
    examples: [],
    isRoot: false,
    isCatchAll: false,
    colorKey: null,
    positionX: 0,
    positionY: 0,
    threadCount: 0,
    ...overrides,
  } as TaxonomyNode;
}

const ROOT = node({ id: "root", isRoot: true, name: "Inbox" });
const WORK = node({ id: "n1", name: "Work" });
const EDGE = { id: "e1", sourceNodeId: "root", targetNodeId: "n1" } as TaxonomyEdge;

function makeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    taxonomyNodes: vi.fn(async () => [ROOT, WORK]),
    taxonomyEdges: vi.fn(async () => [EDGE]),
    createTaxonomyNode: vi.fn(async () => node({ id: "new" })),
    updateTaxonomyNode: vi.fn(async () => WORK),
    deleteTaxonomyNode: vi.fn(async () => ({ ok: true })),
    createTaxonomyEdge: vi.fn(async () => EDGE),
    updateTaxonomyEdge: vi.fn(async () => EDGE),
    deleteTaxonomyEdge: vi.fn(async () => ({ ok: true })),
    taxonomyTemplateRecommendation: vi.fn(async () => ({ recommendedTemplateId: null })),
    previewTaxonomyImport: vi.fn(async () => ({
      suggestions: [],
      migrateCount: 0,
      resortCount: 0,
    })),
    importTaxonomy: vi.fn(async () => ({ ok: true })),
    ...overrides,
  } as unknown as ApiClient;
}

function renderEditor(overrides: Partial<TaxonomyEditorProps> = {}) {
  const props: TaxonomyEditorProps = {
    api: makeApi(),
    workspaceId: "ws-1",
    initialNodes: [ROOT, WORK],
    initialEdges: [EDGE],
    ...overrides,
  };
  // The editor re-reads themed edge colours through useTheme, which requires the
  // provider both hosts already mount at their root.
  render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider>
        <TaxonomyEditor {...props} />
      </ThemeProvider>
    </I18nProvider>
  );
  return props;
}

describe("TaxonomyEditor — read-only", () => {
  it("offers no editing controls and says why", () => {
    renderEditor({ readOnly: true });

    expect(screen.getByText(/view-only/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /add folder/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /templates/i })).toBeNull();
  });
});

describe("TaxonomyEditor — creating a folder", () => {
  it("writes the folder and its parent path through the api client", async () => {
    const api = makeApi();
    renderEditor({ api });

    fireEvent.click(screen.getByRole("button", { name: /add folder/i }));
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Invoices" } });
    fireEvent.change(screen.getByLabelText(/^description/i), {
      target: { value: "Receipts, payment confirmations, and billing questions from vendors." },
    });
    fireEvent.change(screen.getByLabelText(/^parent/i), { target: { value: "root" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() =>
      expect(api.createTaxonomyNode).toHaveBeenCalledWith(
        "ws-1",
        expect.objectContaining({ name: "Invoices" })
      )
    );
    // The parent choice becomes an edge, not a second field on the node.
    await waitFor(() =>
      expect(api.createTaxonomyEdge).toHaveBeenCalledWith("ws-1", {
        sourceNodeId: "root",
        targetNodeId: "new",
      })
    );
  });

  it("keeps Create disabled until the folder has a usable description", () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: /add folder/i }));
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Invoices" } });

    // The description is what the classifier matches on, so an empty one is not
    // a saveable folder.
    expect(screen.getByRole("button", { name: /^create$/i }).hasAttribute("disabled")).toBe(true);
  });
});

describe("TaxonomyEditor — host seams", () => {
  it("opens the template picker when the host asks for it, then reports back", async () => {
    const onModeConsumed = vi.fn();
    renderEditor({ initialMode: "templates", onModeConsumed });

    expect(await screen.findByText(/from a template/i)).toBeTruthy();
    expect(onModeConsumed).toHaveBeenCalled();
  });

  it("routes a deep-linked generate to the connect flow when no mailbox is attached", () => {
    const onConnectMail = vi.fn();
    const onModeConsumed = vi.fn();
    renderEditor({ initialMode: "generate", mailConnected: false, onConnectMail, onModeConsumed });

    // Opening an empty generator would wrongly report "not enough variety".
    expect(onConnectMail).toHaveBeenCalled();
    expect(onModeConsumed).not.toHaveBeenCalled();
  });

  it("renders the host's generate control rather than owning that flow", () => {
    renderEditor({
      generateSlot: (
        <button type="button" data-testid="host-generate">
          Generate from inbox
        </button>
      ),
    });

    // Identified by test id rather than name: the routing-threshold banner also
    // offers to generate, and both reaching the user is the intent.
    expect(screen.getByTestId("host-generate")).toBeTruthy();
  });

  it("applies a proposal the host's generate control accepts", async () => {
    const api = makeApi();
    renderEditor({
      api,
      generateSlot: ({ applyFile }) => (
        <button
          type="button"
          data-testid="host-apply"
          onClick={() =>
            void applyFile({
              amarnaiTaxonomyVersion: 1,
              exportedAt: "2026-01-01T00:00:00.000Z",
              nodes: [],
              edges: [],
            } as never)
          }
        >
          Apply
        </button>
      ),
    });

    fireEvent.click(screen.getByTestId("host-apply"));

    // The host owns the generate UI but not the apply: replacing folders has to
    // run through this component, which knows when a migration review is due.
    await waitFor(() => expect(api.importTaxonomy).toHaveBeenCalled());
  });

  it("hides file import and export where the host asks", () => {
    renderEditor({ showImportExport: false });

    expect(screen.queryByRole("button", { name: /export/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /import/i })).toBeNull();
  });

  it("shows import and export by default", () => {
    renderEditor();

    expect(screen.getByRole("button", { name: /export/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /import/i })).toBeTruthy();
  });
});
