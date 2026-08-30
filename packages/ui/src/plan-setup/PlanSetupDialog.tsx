"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type {
  TaxonomyTransferFile,
  GenerationEligibilityReason,
} from "@aziru/shared";
import type {
  ApiClient,
  TaxonomyGenerationStatusResult,
  TaxonomyImportPreviewResult,
  TaxonomyMigrationMapping,
} from "@aziru/api-client";
import { ApiHttpError } from "@aziru/api-client";
import {
  generationReasonText,
  layoutTaxonomyTransfer,
  transferToDisplayGraph,
} from "@aziru/core/taxonomy";
import { translateSource } from "@aziru/i18n";
import { ReadOnlyTaxonomyCanvas } from "../taxonomy/ReadOnlyTaxonomyCanvas.js";
import { TemplatePicker } from "./TemplatePicker.js";
import { MigrationReviewModal } from "../taxonomy-editor/MigrationReviewModal.js";

export type PlanSetupMode = "choice" | "generate" | "template";

export type PlanSetupDialogProps = {
  api: ApiClient;
  workspaceId: string;
  /** Open straight into one branch, skipping the choice screen. */
  initialMode?: PlanSetupMode;
  /**
   * Open a path in the Amarnai web app. The only escape hatch out of this
   * dialog, so the component stays free of any host knowledge: the extension
   * opens a tab, the injected panel uses its own external-open capability.
   */
  onOpenWeb: (path: string) => void;
  /** Folders were imported. The host reloads whatever it seeded from the taxonomy. */
  onApplied: () => void;
  onClose: () => void;
};

type Step =
  | "choice"
  | "generating"
  | "unavailable"
  | "templates"
  | "preview"
  | "forbidden";

type Proposal = { file: TaxonomyTransferFile; source: "generated" | "template" };

const POLL_MS = 2500;

// Non-ok responses arrive as ApiHttpError (see @aziru/api-client); anything
// else is a transport failure with no status to branch on.
function statusOf(err: unknown): number | null {
  return err instanceof ApiHttpError ? err.status : null;
}

function bodyOf(err: unknown): Record<string, unknown> {
  return (err instanceof ApiHttpError ? err.body : null) ?? {};
}

/**
 * Both of today's sources arrive already laid out: the worker runs
 * layoutTaxonomyTransfer before storing a proposal, and templates are
 * hand-authored to the same convention. A file whose non-root nodes all sit at
 * the origin carries no layout and would render as a single stack, so lay it
 * out before it reaches the canvas. Applied before preview (not only for
 * display) so the positions the user sees are the ones that get stored.
 */
function withLayout(file: TaxonomyTransferFile): TaxonomyTransferFile {
  const positioned = file.nodes.some(
    (n) => !n.isRoot && (n.positionX !== 0 || n.positionY !== 0),
  );
  return positioned ? file : layoutTaxonomyTransfer(file);
}

/**
 * Set up sorting folders without leaving the surface the user is on: generate
 * them from the inbox, or start from a template, previewing the proposal on the
 * read-only canvas before anything is written.
 *
 * Rendered as a full-surface overlay so it works at the extension panel's 360px
 * as well as on a full page. Every host-specific action is a prop.
 */
export function PlanSetupDialog({
  api,
  workspaceId,
  initialMode = "choice",
  onOpenWeb,
  onApplied,
  onClose,
}: PlanSetupDialogProps) {
  const { _, i18n } = useLingui();
  const tReason = useCallback(
    (s: string, v?: Record<string, unknown>) => translateSource(i18n, s, v),
    [i18n],
  );

  const [step, setStep] = useState<Step>(
    initialMode === "generate" ? "generating" : initialMode === "template" ? "templates" : "choice",
  );
  const [error, setError] = useState<string | null>(null);
  // Why generation cannot run right now. Its own state (not `error`) because it
  // is an expected outcome with its own primary action: use a template.
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [applying, setApplying] = useState(false);
  // Set when applying would displace threads that are already filed, so the user
  // decides where each old folder's threads land before anything is replaced.
  const [migration, setMigration] = useState<TaxonomyImportPreviewResult | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const showProposal = useCallback((file: TaxonomyTransferFile, source: Proposal["source"]) => {
    setProposal({ file: withLayout(file), source });
    setStep("preview");
  }, []);

  const showUnavailable = useCallback((text: string) => {
    setUnavailable(text);
    setStep("unavailable");
  }, []);

  // A finished run: show the proposal, or say why there isn't one.
  const settle = useCallback(
    (s: TaxonomyGenerationStatusResult) => {
      if (s.status === "READY" && s.proposal) {
        showProposal(s.proposal, "generated");
        return;
      }
      if (s.status === "INSUFFICIENT") {
        showUnavailable(generationReasonText("INBOX_TOO_SMALL", tReason));
        return;
      }
      showUnavailable(
        s.eligibility.eligible
          ? _(msg`Generation didn't complete. You can start from a template instead.`)
          : generationReasonText(s.eligibility.reason, tReason, s.eligibility.nextEligibleAt),
      );
    },
    [showProposal, showUnavailable, tReason, _],
  );

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(() => {
      api
        .taxonomyGeneration(workspaceId)
        .then((s) => {
          if (s.status === "RUNNING") return;
          stopPolling();
          settle(s);
        })
        // A poll that fails is transient: the next tick tries again rather than
        // dropping the user out of a run that may well be succeeding.
        .catch(() => {});
    }, POLL_MS);
  }, [api, workspaceId, stopPolling, settle]);

  const beginGenerate = useCallback(async () => {
    setError(null);
    setUnavailable(null);
    setStep("generating");

    let status: TaxonomyGenerationStatusResult;
    try {
      status = await api.taxonomyGeneration(workspaceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : _(msg`Couldn't check generation status.`));
      setStep("choice");
      return;
    }

    // Resume a run that is already in flight, or jump straight to a proposal
    // that finished while the panel was closed.
    if (status.status === "RUNNING") {
      startPolling();
      return;
    }
    if (status.status === "READY" && status.proposal) {
      showProposal(status.proposal, "generated");
      return;
    }
    if (status.status === "INSUFFICIENT") {
      showUnavailable(generationReasonText("INBOX_TOO_SMALL", tReason));
      return;
    }
    if (!status.eligibility.eligible) {
      showUnavailable(
        generationReasonText(status.eligibility.reason, tReason, status.eligibility.nextEligibleAt),
      );
      return;
    }

    try {
      await api.generateTaxonomy(workspaceId);
      startPolling();
    } catch (err) {
      const code = statusOf(err);
      if (code === 403) {
        setStep("forbidden");
        return;
      }
      // Someone else started a run between our status read and this POST.
      if (code === 409) {
        startPolling();
        return;
      }
      if (code === 429) {
        const body = bodyOf(err);
        const reason = body["reason"];
        const nextEligibleAt = body["nextEligibleAt"];
        showUnavailable(
          typeof reason === "string"
            ? generationReasonText(
                reason as GenerationEligibilityReason,
                tReason,
                typeof nextEligibleAt === "string" ? nextEligibleAt : null,
              )
            : generationReasonText("COOLDOWN", tReason),
        );
        return;
      }
      setError(err instanceof Error ? err.message : _(msg`Couldn't start generation.`));
      setStep("choice");
    }
  }, [api, workspaceId, startPolling, showProposal, showUnavailable, tReason, _]);

  // Opened straight into generation: start once, even under StrictMode's
  // double-invoked effects.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (initialMode === "generate" && !autoStartedRef.current) {
      autoStartedRef.current = true;
      void beginGenerate();
    }
  }, [initialMode, beginGenerate]);

  async function handleApply() {
    if (!proposal || applying) return;
    setApplying(true);
    setError(null);
    try {
      const preview = await api.previewTaxonomyImport(workspaceId, proposal.file);
      // A workspace with no folders has nothing to carry over. A non-zero count
      // means folders appeared while this dialog was open (another tab, another
      // member), so the user must say where those threads go before anything is
      // replaced. That review runs here rather than handing off to the web app.
      if (preview.migrateCount > 0) {
        setMigration(preview);
        return;
      }
      await api.importTaxonomy(workspaceId, proposal.file);
      onApplied();
      onClose();
    } catch (err) {
      if (statusOf(err) === 403) {
        setStep("forbidden");
        return;
      }
      setError(err instanceof Error ? err.message : _(msg`Couldn't apply the folders.`));
    } finally {
      setApplying(false);
    }
  }

  async function handleMigrate(mapping: TaxonomyMigrationMapping) {
    if (!proposal || applying) return;
    setApplying(true);
    setError(null);
    try {
      await api.importTaxonomy(workspaceId, proposal.file, mapping);
      setMigration(null);
      onApplied();
      onClose();
    } catch (err) {
      if (statusOf(err) === 403) {
        setMigration(null);
        setStep("forbidden");
        return;
      }
      setError(err instanceof Error ? err.message : _(msg`Couldn't apply the folders.`));
    } finally {
      setApplying(false);
    }
  }

  const displayGraph = useMemo(
    () => (proposal ? transferToDisplayGraph(proposal.file) : null),
    [proposal],
  );

  const title =
    step === "templates"
      ? _(msg`Choose a template`)
      : step === "preview"
        ? _(msg`Review your folders`)
        : _(msg`Set up folders`);

  return (
    <div className="ps-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ps-dialog">
        <div className="ps-head">
          <h2 className="ps-title">{title}</h2>
          <button type="button" className="ps-close" onClick={onClose} aria-label={_(msg`Close`)}>
            ✕
          </button>
        </div>

        <div className={`ps-body${step === "preview" ? " ps-body--canvas" : ""}`}>
          {error && (
            <p className="ps-error" role="alert">
              {error}
            </p>
          )}

          {step === "choice" && (
            <>
              <p className="ps-lead">
                <Trans>
                  Amarnai files your mail into folders you choose. Build them from your own
                  inbox, or start from a ready-made set.
                </Trans>
              </p>
              <p className="ps-note">
                <Trans>
                  Generating reads your senders, labels, and subject keywords, never message
                  bodies. You review the result before anything is applied.
                </Trans>
              </p>
            </>
          )}

          {step === "generating" && (
            <div className="ps-progress">
              <span className="ps-spinner" aria-hidden />
              <p className="ps-lead">
                <Trans>Reading your inbox and building your folders. This can take a moment.</Trans>
              </p>
            </div>
          )}

          {step === "unavailable" && (
            <>
              <p className="ps-lead">{unavailable}</p>
              <p className="ps-note">
                <Trans>A template gets you sorting right away, and you can edit it later.</Trans>
              </p>
            </>
          )}

          {step === "templates" && (
            <TemplatePicker
              api={api}
              workspaceId={workspaceId}
              onSelect={(file) => showProposal(file, "template")}
            />
          )}

          {step === "preview" && displayGraph && (
            <>
              <p className="ps-note">
                <Trans>These folders will be created. You can edit them at any time.</Trans>
              </p>
              <div className="ps-canvas">
                <ReadOnlyTaxonomyCanvas nodes={displayGraph.nodes} edges={displayGraph.edges} />
              </div>
            </>
          )}

          {step === "forbidden" && (
            <p className="ps-lead">
              <Trans>A workspace owner manages this workspace's folders.</Trans>
            </p>
          )}
        </div>

        <div className="ps-foot">
          {step === "choice" && (
            <>
              <button type="button" className="ps-btn ps-btn--primary" onClick={() => void beginGenerate()}>
                <Trans>Generate from inbox</Trans>
              </button>
              <button type="button" className="ps-btn" onClick={() => setStep("templates")}>
                <Trans>Use a template</Trans>
              </button>
            </>
          )}

          {step === "generating" && (
            <button type="button" className="ps-btn" onClick={onClose}>
              <Trans>Close</Trans>
            </button>
          )}

          {step === "unavailable" && (
            <>
              <button type="button" className="ps-btn ps-btn--primary" onClick={() => setStep("templates")}>
                <Trans>Use a template</Trans>
              </button>
              <button type="button" className="ps-btn" onClick={onClose}>
                <Trans>Close</Trans>
              </button>
            </>
          )}

          {step === "templates" && (
            <button type="button" className="ps-btn" onClick={() => setStep("choice")}>
              <Trans>Back</Trans>
            </button>
          )}

          {step === "preview" && (
            <>
              <button
                type="button"
                className="ps-btn ps-btn--primary"
                onClick={() => void handleApply()}
                disabled={applying}
              >
                {applying ? <Trans>Applying…</Trans> : <Trans>Use these folders</Trans>}
              </button>
              <button
                type="button"
                className="ps-btn"
                onClick={() => setStep(proposal?.source === "template" ? "templates" : "choice")}
                disabled={applying}
              >
                <Trans>Back</Trans>
              </button>
            </>
          )}

          {step === "forbidden" && (
            <>
              <button
                type="button"
                className="ps-btn ps-btn--primary"
                onClick={() => onOpenWeb("/folders")}
              >
                <Trans>Open the folder editor</Trans>
              </button>
              <button type="button" className="ps-btn" onClick={onClose}>
                <Trans>Close</Trans>
              </button>
            </>
          )}
        </div>
      </div>

      {migration && proposal && (
        <MigrationReviewModal
          file={proposal.file}
          preview={migration}
          submitting={applying}
          onCancel={() => setMigration(null)}
          onConfirm={(mapping) => void handleMigrate(mapping)}
        />
      )}
    </div>
  );
}
