import { render, cleanup } from "@/test-utils";
import { describe, it, expect, afterEach } from "vitest";
import { BackfillCard } from "@amarnai/ui/emails";
import type { SyncInfo } from "@amarnai/ui/emails/types";

afterEach(cleanup);

/** A fully-populated SyncInfo; override per case. */
function syncInfo(over: Partial<NonNullable<SyncInfo>> = {}): SyncInfo {
  return {
    lastSyncedAt: null,
    backfillStatus: "RUNNING",
    backfillLoadedThreads: 0,
    backfillTotalThreads: 0,
    backfillAwaitingTaxonomy: false,
    workspacePlan: "FREE",
    pushEnabled: false,
    ...over,
  };
}

describe("BackfillCard", () => {
  it("shows the loading card on a FREE plan instead of an upsell", () => {
    const { container } = render(
      <BackfillCard syncInfo={syncInfo({ workspacePlan: "FREE" })} />
    );

    const text = container.textContent ?? "";
    expect(text).toContain("Loading past threads…");
    expect(text).not.toMatch(/upgrade/i);
    // Indeterminate bar, no count or percentage (Gmail has no reliable total).
    expect(container.querySelector(".em-backfill-progress-bar--indeterminate")).not.toBeNull();
    expect(text).not.toContain("%");
    expect(text).not.toContain("Preparing");
  });

  it("adapts the subtext while the taxonomy is not yet routable", () => {
    const { container } = render(
      <BackfillCard syncInfo={syncInfo({ backfillAwaitingTaxonomy: true })} />
    );
    expect(container.textContent ?? "").toContain("Your past threads are being loaded and will appear shortly.");
  });

  it("renders nothing when no backfill is running", () => {
    const { container } = render(<BackfillCard syncInfo={syncInfo({ backfillStatus: "IDLE" })} />);
    expect(container.querySelector(".em-backfill")).toBeNull();
  });
});
