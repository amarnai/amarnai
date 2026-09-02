"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TaxonomyTransferFile } from "@aziru/shared";
import type {
  TaxonomyGenerationStatusResult,
  GenerationEligibilityReason,
} from "@aziru/api-client";
import { generationReasonText, transferToDisplayGraph } from "@aziru/core/taxonomy";
import { Tooltip } from "@aziru/ui";
import { ReadOnlyTaxonomyCanvas } from "@aziru/ui/taxonomy";
import { api } from "@/lib/api";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { translateSource } from "@aziru/i18n";

type Phase = "idle" | "running" | "ready" | "insufficient" | "failed" | "error";

const POLL_MS = 2500;

// With no inbox connected there is nothing to generate from, so every
// "Generate from inbox" entry point sends the user to the Gmail OAuth flow
// instead of opening an empty generator that would wrongly report
// "not enough variety". Shared so all call sites stay consistent.
export function startGmailConnect(workspaceId: string) {
  window.location.href = `/api/gmail/connect?workspaceId=${workspaceId}`;
}

export function GenerateFromInboxButton({
  workspaceId,
  disabled,
  gmailConnected,
  onApply,
  onUseTemplates,
  variant = "ghost",
  withTooltip = true,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
}: {
  workspaceId: string;
  disabled: boolean;
  gmailConnected: boolean;
  onApply: (file: TaxonomyTransferFile) => Promise<void>;
  onUseTemplates: () => void;
  /** Toolbar uses "ghost"; the onboarding banner uses "primary". */
  variant?: "ghost" | "primary";
  withTooltip?: boolean;
  /** Open the modal immediately on mount (e.g. navigated via ?openGenerate=1). */
  defaultOpen?: boolean;
  /** Externally controlled open state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { _, i18n } = useLingui();
  const tReason = useCallback(
    (s: string, v?: Record<string, unknown>) => translateSource(i18n, s, v),
    [i18n],
  );
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  function setOpen(v: boolean) {
    setInternalOpen(v);
    onOpenChange?.(v);
  }
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<TaxonomyGenerationStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Set while the open modal is waiting out the initial inbox import (reason
  // IMPORTING); when the eligibility floor clears, generation continues
  // automatically instead of dropping the user on another button.
  const waitedRef = useRef(false);
  // Latest handleGenerate, so refresh can auto-continue without a dep cycle.
  const generateRef = useRef<(() => Promise<void>) | null>(null);

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
      const s = await api.taxonomyGeneration(workspaceId);
      applyStatus(s);
      if (s.status === "RUNNING") return s;
      // Under the eligibility floor only because the initial import is still
      // syncing: keep polling, and continue straight into generation the
      // moment the floor clears — the user already asked for it by opening
      // the generator.
      if (s.eligibility.reason === "IMPORTING") {
        waitedRef.current = true;
        return s;
      }
      stopPolling();
      if (waitedRef.current) {
        waitedRef.current = false;
        if (s.eligibility.eligible) void generateRef.current?.();
      }
      return s;
    } catch (err) {
      setError(err instanceof Error ? err.message : _(msg`Failed to load status`));
      setPhase("error");
      stopPolling();
      return null;
    }
  }, [workspaceId, applyStatus, stopPolling, _]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(() => void refresh(), POLL_MS);
  }, [refresh, stopPolling]);

  // Reset state and load fresh status each time the modal opens. If generation
  // is already in progress, or the initial import is still syncing the inbox up
  // to the eligibility floor, resume live polling immediately.
  useEffect(() => {
    if (open) {
      setError(null);
      setStatus(null);
      setPhase("idle");
      waitedRef.current = false;
      void refresh().then((s) => {
        if (s && (s.status === "RUNNING" || s.eligibility.reason === "IMPORTING")) startPolling();
      });
    }
    return () => stopPolling();
  }, [open, refresh, startPolling, stopPolling]);

  async function handleGenerate() {
    setError(null);
    setPhase("running");
    try {
      const res = await fetch(`/api/internal/workspaces/${workspaceId}/taxonomy-generate`, {
        method: "POST",
        cache: "no-store",
      });
      if (res.ok) {
        startPolling();
        return;
      }
      const body = await res.json().catch(() => ({})) as { error?: string; reason?: string; nextEligibleAt?: string };
      if (res.status === 409) {
        // Already running — sync state and let polling take over.
        await refresh();
        return;
      }
      if (res.status === 429) {
        // Limiter denial — refresh to get current eligibility, then show reason.
        await refresh();
        if (body.reason && body.reason !== "RUNNING") {
          setError(generationReasonText(body.reason as GenerationEligibilityReason, tReason, body.nextEligibleAt));
        }
        return;
      }
      throw new Error(body.error ?? _(msg`API error ${res.status}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : _(msg`Failed to start generation`));
      setPhase("error");
    }
  }
  useEffect(() => {
    generateRef.current = handleGenerate;
  });

  async function handleApply() {
    if (!status?.proposal) return;
    setApplying(true);
    setError(null);
    try {
      await onApply(status.proposal);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : _(msg`Failed to apply`));
    } finally {
      setApplying(false);
    }
  }

  const eligibility = status?.eligibility;
  const canGenerate = eligibility?.eligible ?? false;
  const displayGraph = status?.proposal ? transferToDisplayGraph(status.proposal) : null;

  // With no inbox connected there is nothing to generate from, so the button
  // starts the Gmail OAuth flow instead of opening the (empty) modal.
  function handleButtonClick() {
    if (!gmailConnected) {
      startGmailConnect(workspaceId);
      return;
    }
    setOpen(true);
  }

  // When generation is unavailable (ineligible inbox, insufficient result, or a
  // failed run) the productive action is to start from a template, so we surface
  // that instead of a dead-end disabled "Generate" button.
  const showGenerate = (phase === "idle" || phase === "error" || phase === "failed") && canGenerate;
  const showUseTemplate =
    phase === "insufficient" ||
    phase === "failed" ||
    ((phase === "idle" || phase === "error") && !canGenerate);

  const triggerButton = (
    <button
      className={variant === "primary" ? "btn-primary" : "btn-ghost"}
      onClick={handleButtonClick}
      disabled={disabled}
      aria-label={_(msg`Generate folders from inbox`)}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path
          d="M3 1.5L3.7 3.3L5.5 4L3.7 4.7L3 6.5L2.3 4.7L0.5 4L2.3 3.3ZM9.5 5L10.6 7.9L13.5 9L10.6 10.1L9.5 13L8.4 10.1L5.5 9L8.4 7.9Z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
      <Trans>Generate from inbox</Trans>
    </button>
  );

  return (
    <>
      {withTooltip ? (
        <Tooltip
          content={
            gmailConnected
              ? _(msg`Generate folders from your inbox`)
              : _(msg`Connect Gmail to generate folders from your inbox`)
          }
        >
          {triggerButton}
        </Tooltip>
      ) : (
        triggerButton
      )}

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
          <div className={`modal${phase === "ready" ? " modal--wide" : " modal--illustrated"}`}>
            {phase !== "ready" && (
              <div className="modal-illo-col">
                <img
                  src={canGenerate || phase === "running" ? "/aziru-generate-taxonomy.png" : "/aziru-templates.png"}
                  alt=""
                />
              </div>
            )}

            <div className="modal-main-col">
              <div className="modal-header">
                <h2 className="modal-title"><Trans>Generate from inbox</Trans></h2>
                <button className="modal-close" aria-label={_(msg`Close`)} onClick={() => setOpen(false)}>
                  ✕
                </button>
              </div>

              <div className="modal-body" style={phase !== "ready" ? { overflowY: "auto", maxHeight: "60vh" } : undefined}>
                {error && <p className="form-error">{error}</p>}

                {status?.importing && phase !== "running" && canGenerate && (
                  <p className="text-muted" style={{ marginBottom: 8 }}>
                    <Trans>
                      Your inbox is still importing. You can generate now from what&apos;s loaded so far,
                      but regenerating once the import finishes will give a more accurate fit.
                    </Trans>
                  </p>
                )}

                {phase === "running" && (
                  <p className="text-muted">
                    <Trans>Analyzing your inbox and building your folders… this can take a moment.</Trans>
                  </p>
                )}

                {phase === "insufficient" && (
                  <p className="text-muted">
                    {generationReasonText("INBOX_TOO_SMALL", tReason)}
                  </p>
                )}

                {phase === "failed" && (
                  <p className="text-muted">
                    <Trans>Generation didn&apos;t complete.</Trans>{" "}
                    {eligibility?.nextEligibleAt
                      ? _(msg`You can try again after ${new Date(eligibility.nextEligibleAt).toLocaleString()}, or start from a template.`)
                      : _(msg`You can try again shortly, or start from a template.`)}
                  </p>
                )}

                {(phase === "idle" || phase === "error") && (
                  <>
                    <p className="text-muted" style={{ marginBottom: 8 }}>
                      <Trans>
                        Aziru will analyze your senders, labels, and subject keywords (never message
                        bodies) to suggest a personalized set of folders. You can review and edit before
                        anything is applied.
                      </Trans>
                    </p>
                    {!canGenerate && eligibility && (
                      <p className="text-muted">
                        {eligibility.reason === "IMPORTING" ? (
                          // The modal is polling and will generate by itself, so
                          // no "check back later" — just say what it's doing.
                          <Trans>
                            Your inbox is still loading. Your folders will be generated as soon as
                            enough of it has arrived.
                          </Trans>
                        ) : (
                          generationReasonText(eligibility.reason, tReason, eligibility.nextEligibleAt)
                        )}
                      </p>
                    )}
                  </>
                )}

                {phase === "ready" && displayGraph && (
                  <div>
                    <p className="alert alert-info">
                      <Trans>Applying replaces your current plan. You can fully edit it afterward.</Trans>
                    </p>
                    <div style={{ height: 520 }}>
                      <ReadOnlyTaxonomyCanvas nodes={displayGraph.nodes} edges={displayGraph.edges} />
                    </div>
                  </div>
                )}
              </div>

              <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setOpen(false)} disabled={applying}>
                {phase === "ready" ? <Trans>Discard</Trans> : <Trans>Close</Trans>}
              </button>

              {showUseTemplate && (
                <button
                  className={showGenerate ? "btn-ghost" : "btn-primary"}
                  onClick={() => {
                    setOpen(false);
                    onUseTemplates();
                  }}
                >
                  <Trans>Use a template</Trans>
                </button>
              )}

              {phase === "ready" && (
                <button className="btn-primary" onClick={handleApply} disabled={applying}>
                  {applying ? <Trans>Applying…</Trans> : <Trans>Apply</Trans>}
                </button>
              )}

              {showGenerate && (
                <button className="btn-primary" onClick={handleGenerate}>
                  <Trans>Generate</Trans>
                </button>
              )}

              {phase === "ready" && canGenerate && (
                <button className="btn-ghost" onClick={handleGenerate} disabled={applying}>
                  <Trans>Regenerate</Trans>
                </button>
              )}

              {phase === "running" && (
                <button className="btn-primary" disabled>
                  <Trans>Generating…</Trans>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      )}
    </>
  );
}
