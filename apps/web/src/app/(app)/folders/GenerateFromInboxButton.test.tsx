import { act, cleanup, render, screen } from "@/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaxonomyTransferFile } from "@aziru/shared";
import { GenerateFromInboxButton } from "./GenerateFromInboxButton";

// ReactFlow cannot measure in jsdom; what matters here is the wait/generate
// state machine, not how the proposal graph renders.
vi.mock("@aziru/ui/taxonomy", () => ({
  ReadOnlyTaxonomyCanvas: () => <div data-testid="canvas" />,
}));

const taxonomyGeneration = vi.fn();
vi.mock("@/lib/api", () => ({
  api: { taxonomyGeneration: (...args: unknown[]) => taxonomyGeneration(...args) },
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  taxonomyGeneration.mockReset();
});

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
  ],
  edges: [],
};

const IDLE = {
  status: "IDLE" as const,
  importing: true,
  matchedTemplateId: null,
  lastOutcome: null,
  proposal: null,
};

describe("GenerateFromInboxButton import wait", () => {
  it("waits out the initial import, then generates without another click", async () => {
    vi.useFakeTimers();
    taxonomyGeneration
      // Open: under the floor because the backfill is still syncing.
      .mockResolvedValueOnce({ ...IDLE, eligibility: { eligible: false, reason: "IMPORTING" } })
      // Next tick: the floor cleared — generation should start by itself.
      .mockResolvedValueOnce({ ...IDLE, eligibility: { eligible: true, reason: "OK" } })
      // Generation polling: the run finished.
      .mockResolvedValue({
        ...IDLE,
        status: "READY",
        proposal: PROPOSAL,
        eligibility: { eligible: true, reason: "OK" },
      });
    const fetchMock = vi.fn(async (_url: RequestInfo | URL) => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GenerateFromInboxButton
        workspaceId="ws1"
        disabled={false}
        gmailConnected
        onApply={vi.fn(async () => {})}
        onUseTemplates={vi.fn()}
        withTooltip={false}
        defaultOpen
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText(/still loading/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/taxonomy-generate");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
  });

  it("stops waiting when the import ends with the inbox still too small", async () => {
    vi.useFakeTimers();
    taxonomyGeneration
      .mockResolvedValueOnce({ ...IDLE, eligibility: { eligible: false, reason: "IMPORTING" } })
      // The server flips IMPORTING to the terminal reason once the backfill ends.
      .mockResolvedValue({
        ...IDLE,
        importing: false,
        eligibility: { eligible: false, reason: "INBOX_TOO_SMALL" },
      });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GenerateFromInboxButton
        workspaceId="ws1"
        disabled={false}
        gmailConnected
        onApply={vi.fn(async () => {})}
        onUseTemplates={vi.fn()}
        withTooltip={false}
        defaultOpen
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText(/still loading/)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(screen.getByText(/doesn't have enough variety yet/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Use a template" })).toBeInTheDocument();
  });
});
