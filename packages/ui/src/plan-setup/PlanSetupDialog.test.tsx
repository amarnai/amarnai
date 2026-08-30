// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { TaxonomyTransferFile } from "@aziru/shared";
import type { ApiClient } from "@aziru/api-client";
import { ApiHttpError } from "@aziru/api-client";
import { PlanSetupDialog, type PlanSetupDialogProps } from "./PlanSetupDialog.js";

// ReactFlow cannot measure in jsdom, so the canvas is stubbed. What matters
// here is the state machine and which API calls each path makes, not how the
// graph renders.
vi.mock("../taxonomy/ReadOnlyTaxonomyCanvas.js", () => ({
  ReadOnlyTaxonomyCanvas: ({ nodes }: { nodes: { id: string }[] }) => (
    <div data-testid="canvas">{nodes.length}</div>
  ),
}));

i18n.load("en", {});
i18n.activate("en");

// Vitest runs without globals here, so testing-library's automatic afterEach
// cleanup never registers; without this, renders accumulate across tests.
afterEach(cleanup);

const PROPOSAL: TaxonomyTransferFile = {
  amarnaiTaxonomyVersion: 1,
  exportedAt: "2026-01-01T00:00:00.000Z",
  nodes: [
    {
      ref: "root",
      name: "Inbox",
      description: null,
      instructions: null,
      draftPrompt: null,
      examples: [],
      isRoot: true,
      positionX: 0,
      positionY: 0,
    },
    {
      ref: "work",
      name: "Work",
      description: null,
      instructions: null,
      draftPrompt: null,
      examples: [],
      isRoot: false,
      positionX: 300,
      positionY: 0,
    },
  ],
  edges: [{ sourceRef: "root", targetRef: "work" }],
};

const ELIGIBLE = { eligible: true, reason: "OK" as const };

function makeApi(overrides: Record<string, unknown> = {}): ApiClient {
  return {
    taxonomyGeneration: vi.fn(async () => ({
      status: "IDLE" as const,
      eligibility: ELIGIBLE,
      importing: false,
      matchedTemplateId: null,
      lastOutcome: null,
      proposal: null,
    })),
    generateTaxonomy: vi.fn(async () => ({ ok: true as const, status: "RUNNING" })),
    taxonomyTemplateRecommendation: vi.fn(async () => ({ recommendedTemplateId: null })),
    previewTaxonomyImport: vi.fn(async () => ({
      suggestions: [],
      migrateCount: 0,
      resortCount: 0,
    })),
    importTaxonomy: vi.fn(async () => ({
      ok: true as const,
      nodeCount: 2,
      edgeCount: 1,
      migratedThreads: 0,
      requeuedThreads: 0,
    })),
    ...overrides,
  } as unknown as ApiClient;
}

function renderDialog(api: ApiClient, props: Partial<PlanSetupDialogProps> = {}) {
  const onApplied = props.onApplied ?? vi.fn();
  const onOpenWeb = props.onOpenWeb ?? vi.fn();
  const onClose = props.onClose ?? vi.fn();
  render(
    <I18nProvider i18n={i18n}>
      <PlanSetupDialog
        api={api}
        workspaceId="ws1"
        {...props}
        onApplied={onApplied}
        onOpenWeb={onOpenWeb}
        onClose={onClose}
      />
    </I18nProvider>,
  );
  return { onApplied, onOpenWeb, onClose };
}

const click = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole("button", { name }));

describe("PlanSetupDialog", () => {
  it("previews a finished proposal and imports it", async () => {
    const api = makeApi({
      // The pre-flight read finds a run that already completed, so no POST is
      // needed and the user lands straight on the preview.
      taxonomyGeneration: vi.fn(async () => ({
        status: "READY" as const,
        eligibility: ELIGIBLE,
        importing: false,
        matchedTemplateId: null,
        lastOutcome: null,
        proposal: PROPOSAL,
      })),
    });
    const { onApplied, onClose } = renderDialog(api);

    click("Generate from inbox");
    expect((await screen.findByTestId("canvas")).textContent).toBe("2");
    expect(api.generateTaxonomy).not.toHaveBeenCalled();

    click("Use these folders");

    await waitFor(() => expect(api.importTaxonomy).toHaveBeenCalledWith("ws1", PROPOSAL));
    expect(onApplied).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the limiter reason and promotes the template fallback on 429", async () => {
    const api = makeApi({
      generateTaxonomy: vi.fn(async () => {
        throw new ApiHttpError("Not eligible", 429, {
          reason: "MONTHLY_CAP",
          nextEligibleAt: "2026-08-01T00:00:00.000Z",
        });
      }),
    });
    renderDialog(api);

    click("Generate from inbox");

    expect(await screen.findByText(/You've used your generations for now/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Use a template" })).toBeDefined();
  });

  it("falls back to templates when the inbox has too little signal", async () => {
    const api = makeApi({
      taxonomyGeneration: vi.fn(async () => ({
        status: "INSUFFICIENT" as const,
        eligibility: ELIGIBLE,
        importing: false,
        matchedTemplateId: null,
        lastOutcome: null,
        proposal: null,
      })),
    });
    renderDialog(api);

    click("Generate from inbox");

    expect(await screen.findByText(/doesn't have enough variety yet/)).toBeDefined();
    click("Use a template");
    expect(await screen.findByRole("button", { name: /Freelancer/ })).toBeDefined();
  });

  it("imports a template directly when nothing has to be migrated", async () => {
    const api = makeApi();
    const { onApplied } = renderDialog(api, { initialMode: "template" });

    fireEvent.click(await screen.findByRole("button", { name: /Freelancer/ }));
    expect(await screen.findByTestId("canvas")).toBeDefined();

    click("Use these folders");

    await waitFor(() => expect(api.importTaxonomy).toHaveBeenCalled());
    expect(onApplied).toHaveBeenCalled();
  });

  it("reviews the migration in place when threads would have to be moved", async () => {
    const api = makeApi({
      previewTaxonomyImport: vi.fn(async () => ({
        suggestions: [
          {
            oldNodeId: "n-old",
            oldName: "Clients",
            threadCount: 12,
            suggestedRef: null,
            isCatchAll: false,
          },
        ],
        migrateCount: 12,
        resortCount: 3,
      })),
    });
    const { onOpenWeb, onApplied } = renderDialog(api, { initialMode: "template" });

    fireEvent.click(await screen.findByRole("button", { name: /Freelancer/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Use these folders" }));

    // The review happens here rather than sending the user to the web editor.
    expect(await screen.findByText("Replace folders")).toBeDefined();
    expect(onOpenWeb).not.toHaveBeenCalled();
    expect(api.importTaxonomy).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("applies the reviewed mapping without leaving the dialog", async () => {
    const api = makeApi({
      previewTaxonomyImport: vi.fn(async () => ({
        suggestions: [
          {
            oldNodeId: "n-old",
            oldName: "Clients",
            threadCount: 12,
            suggestedRef: "work",
            isCatchAll: false,
          },
        ],
        migrateCount: 12,
        resortCount: 0,
      })),
    });
    const { onApplied } = renderDialog(api, { initialMode: "template" });

    fireEvent.click(await screen.findByRole("button", { name: /Freelancer/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Use these folders" }));
    fireEvent.click(await screen.findByRole("button", { name: /Migrate & apply/ }));

    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    // The user's per-folder choices reach the server, not a bare file import.
    expect(api.importTaxonomy).toHaveBeenCalledWith(
      "ws1",
      expect.anything(),
      expect.objectContaining({ "n-old": "work" })
    );
  });

  it("shows the forbidden state and links out when the user may not edit the folders", async () => {
    const api = makeApi({
      generateTaxonomy: vi.fn(async () => {
        throw new ApiHttpError("Taxonomy editing is restricted to workspace admins", 403, null);
      }),
    });
    const { onOpenWeb } = renderDialog(api);

    click("Generate from inbox");

    expect(
      await screen.findByText("A workspace owner manages this workspace's folders."),
    ).toBeDefined();
    click("Open the folder editor");
    expect(onOpenWeb).toHaveBeenCalledWith("/folders");
  });
});
