"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TaxonomyTransferFile } from "@amarnai/shared";
import type {
  TaxonomyGenerationStatusResult,
  GenerationEligibilityReason,
} from "@amarnai/api-client";
import { Tooltip } from "@amarnai/ui";
import {
  generateTaxonomyAction,
  getTaxonomyGenerationAction,
} from "@/actions/taxonomy";

type Phase = "idle" | "running" | "ready" | "insufficient" | "failed" | "error";

const POLL_MS = 2500;

/** User-facing copy for each not-eligible reason. */
function reasonText(reason: GenerationEligibilityReason, nextEligibleAt?: string): string {
  const when = nextEligibleAt ? new Date(nextEligibleAt).toLocaleString() : null;
  switch (reason) {
    case "INBOX_TOO_SMALL":
      return "Your inbox doesn't have enough variety yet to personalize a taxonomy. Choose a template instead.";
    case "IMPORTING":
      return "Still importing your inbox. Check back once the import finishes.";
    case "NO_NEW_MAIL":
      return "No significant new mail since your last generation, so the result would be the same. Available again once your inbox grows.";
    case "COOLDOWN":
      return when ? `Recently attempted. Available again ${when}.` : "Recently attempted. Try again later.";
    case "MONTHLY_CAP":
      return when
        ? `You've used your generations for now. Available again ${when}.`
        : "You've used your generations for now.";
    default:
      return "Generation isn't available right now.";
  }
}

/** Build an ordered, breadcrumbed list of the proposed folders for preview. */
function previewRows(file: TaxonomyTransferFile): { name: string; breadcrumb: string; description: string }[] {
  const byRef = new Map(file.nodes.map((n) => [n.ref, n]));
  const parent = new Map<string, string>();
  for (const e of file.edges) parent.set(e.targetRef, e.sourceRef);
  const breadcrumb = (ref: string): string => {
    const chain: string[] = [];
    let cur: string | undefined = ref;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const node = byRef.get(cur);
      if (!node) break;
      chain.unshift(node.name);
      cur = parent.get(cur);
    }
    return chain.slice(0, -1).join(" → ");
  };
  return file.nodes
    .filter((n) => !n.isRoot)
    .map((n) => ({
      name: n.name,
      breadcrumb: breadcrumb(n.ref),
      description: n.description ?? "",
    }));
}

export function GenerateFromInboxButton({
  workspaceId,
  disabled,
  onApply,
  onUseTemplates,
}: {
  workspaceId: string;
  disabled: boolean;
  onApply: (file: TaxonomyTransferFile) => Promise<void>;
  onUseTemplates: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<TaxonomyGenerationStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const applyStatus = useCallback((s: TaxonomyGenerationStatusResult) => {
    setStatus(s);
    if (s.status === "RUNNING") setPhase("running");
    else if (s.status === "READY" && s.proposal) setPhase("ready");
    else if (s.status === "INSUFFICIENT") setPhase("insufficient");
    else if (s.status === "FAILED") setPhase("failed");
    else setPhase("idle");
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await getTaxonomyGenerationAction(workspaceId);
      applyStatus(s);
      if (s.status !== "RUNNING") stopPolling();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status");
      setPhase("error");
      stopPolling();
    }
  }, [workspaceId, applyStatus, stopPolling]);

  // Load status when the modal opens; tear down polling when it closes/unmounts.
  useEffect(() => {
    if (open) void refresh();
    return () => stopPolling();
  }, [open, refresh, stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(() => void refresh(), POLL_MS);
  }, [refresh, stopPolling]);

  async function handleGenerate() {
    setError(null);
    setPhase("running");
    try {
      const res = await generateTaxonomyAction(workspaceId);
      if (!res.ok) {
        // Limiter denial / already running — show the reason and stop.
        await refresh();
        if (res.reason && res.reason !== "RUNNING") {
          setError(reasonText(res.reason as GenerationEligibilityReason, res.nextEligibleAt));
        }
        return;
      }
      startPolling();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start generation");
      setPhase("error");
    }
  }

  async function handleApply() {
    if (!status?.proposal) return;
    setApplying(true);
    setError(null);
    try {
      await onApply(status.proposal);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply");
    } finally {
      setApplying(false);
    }
  }

  const eligibility = status?.eligibility;
  const canGenerate = eligibility?.eligible ?? false;

  // When generation is unavailable (ineligible inbox, insufficient result, or a
  // failed run) the productive action is to start from a template, so we surface
  // that instead of a dead-end disabled "Generate" button.
  const showGenerate = (phase === "idle" || phase === "error" || phase === "failed") && canGenerate;
  const showUseTemplate =
    phase === "insufficient" ||
    phase === "failed" ||
    ((phase === "idle" || phase === "error") && !canGenerate);

  return (
    <>
      <Tooltip content="Generate a taxonomy from your inbox">
        <button
          className="btn-ghost"
          onClick={() => setOpen(true)}
          disabled={disabled}
          aria-label="Generate taxonomy from inbox"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path
              d="M3 1.5L3.7 3.3L5.5 4L3.7 4.7L3 6.5L2.3 4.7L0.5 4L2.3 3.3ZM9.5 5L10.6 7.9L13.5 9L10.6 10.1L9.5 13L8.4 10.1L5.5 9L8.4 7.9Z"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
          Generate from inbox
        </button>
      </Tooltip>

      {open && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal">
            <div className="modal-header">
              <h2 className="modal-title">Generate from inbox</h2>
              <button className="modal-close" aria-label="Close" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>

            <div className="modal-body" style={{ overflowY: "auto", maxHeight: "60vh" }}>
              {error && <p className="form-error">{error}</p>}

              {phase === "running" && (
                <p className="text-muted">
                  Analyzing your inbox and building a taxonomy… this can take a moment.
                </p>
              )}

              {phase === "insufficient" && (
                <p className="text-muted">
                  {reasonText("INBOX_TOO_SMALL")}
                </p>
              )}

              {phase === "failed" && (
                <p className="text-muted">
                  Generation didn&apos;t complete.{" "}
                  {eligibility?.nextEligibleAt
                    ? `You can try again after ${new Date(eligibility.nextEligibleAt).toLocaleString()}, or start from a template.`
                    : "You can try again shortly, or start from a template."}
                </p>
              )}

              {(phase === "idle" || phase === "error") && (
                <>
                  <p className="text-muted" style={{ marginBottom: 8 }}>
                    Amarnai will analyze your senders, labels, and subject keywords (never message
                    bodies) to suggest a personalized set of folders. You can review and edit before
                    anything is applied.
                  </p>
                  {!canGenerate && eligibility && (
                    <p className="text-muted">{reasonText(eligibility.reason, eligibility.nextEligibleAt)}</p>
                  )}
                </>
              )}

              {phase === "ready" && status?.proposal && (
                <div>
                  <p className="text-muted" style={{ marginBottom: 10 }}>
                    Proposed folders. Applying replaces your current taxonomy; you can edit
                    everything afterward.
                  </p>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                    {previewRows(status.proposal).map((row, i) => (
                      <li key={`${row.name}-${i}`}>
                        <div style={{ fontWeight: 600 }}>
                          {row.name}
                          {row.breadcrumb && (
                            <span className="text-muted" style={{ fontWeight: 400, marginLeft: 6 }}>
                              ({row.breadcrumb})
                            </span>
                          )}
                        </div>
                        <div className="text-muted" style={{ fontSize: 13 }}>{row.description}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setOpen(false)} disabled={applying}>
                {phase === "ready" ? "Discard" : "Close"}
              </button>

              {showUseTemplate && (
                <button
                  className={showGenerate ? "btn-ghost" : "btn-primary"}
                  onClick={() => {
                    setOpen(false);
                    onUseTemplates();
                  }}
                >
                  Use a template
                </button>
              )}

              {phase === "ready" && (
                <button className="btn-primary" onClick={handleApply} disabled={applying}>
                  {applying ? "Applying…" : "Apply"}
                </button>
              )}

              {showGenerate && (
                <button className="btn-primary" onClick={handleGenerate}>
                  Generate
                </button>
              )}

              {phase === "ready" && canGenerate && (
                <button className="btn-ghost" onClick={handleGenerate} disabled={applying}>
                  Regenerate
                </button>
              )}

              {phase === "running" && (
                <button className="btn-primary" disabled>
                  Generating…
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
