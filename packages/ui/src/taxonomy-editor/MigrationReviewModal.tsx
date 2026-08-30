"use client";

import { Fragment, useMemo, useState } from "react";
import { Trans, Plural } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { TaxonomyTransferFile } from "@aziru/shared";
import type {
  TaxonomyImportPreviewResult,
  TaxonomyMigrationMapping,
} from "@aziru/api-client";
import "./taxonomy-editor.css";

const RESORT = "resort" as const;

export type MigrationReviewModalProps = {
  file: TaxonomyTransferFile;
  preview: TaxonomyImportPreviewResult;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (mapping: TaxonomyMigrationMapping) => void;
};

/**
 * Pre-apply review for replacing the taxonomy. Shows, per old folder that holds
 * threads, whether those threads carry over to a matched new folder or get
 * re-sorted by AI, with editable defaults. One click on "Migrate and apply"
 * accepts the auto-matched defaults.
 */
export function MigrationReviewModal({
  file,
  preview,
  submitting,
  onCancel,
  onConfirm,
}: MigrationReviewModalProps) {
  const { _ } = useLingui();

  // New (incoming) non-root folders, minus the catch-all (never a manual target).
  const newFolders = useMemo(
    () =>
      file.nodes
        .filter((n) => !n.isRoot && !(n.isCatchAll ?? false))
        .map((n) => ({ ref: n.ref, name: n.name })),
    [file]
  );

  // Rows with threads, catch-all shown but locked. Zero-thread folders are hidden.
  const rows = useMemo(
    () => preview.suggestions.filter((s) => s.threadCount > 0),
    [preview]
  );
  const editableRows = rows.filter((r) => !r.isCatchAll);
  const catchAllRow = rows.find((r) => r.isCatchAll) ?? null;
  const hiddenCount = preview.suggestions.length - rows.length;

  // Per-old-folder choice: a new ref or the "resort" sentinel. Defaults to the
  // server's suggestion (or resort when none).
  const [choices, setChoices] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of editableRows) init[s.oldNodeId] = s.suggestedRef ?? RESORT;
    return init;
  });

  // Threads that always re-sort regardless of mapping (needs-review + unclassified):
  // the server's resortCount minus the SORTED threads under folders it defaulted
  // to resort. Keeps the live totals consistent as the user toggles rows.
  const fixedReviewResort = useMemo(() => {
    const defaultResortThreads = editableRows
      .filter((s) => s.suggestedRef == null)
      .reduce((sum, s) => sum + s.threadCount, 0);
    return Math.max(0, preview.resortCount - defaultResortThreads);
  }, [editableRows, preview.resortCount]);

  const migrateLive = editableRows
    .filter((s) => choices[s.oldNodeId] !== RESORT)
    .reduce((sum, s) => sum + s.threadCount, 0);
  const resortLive =
    fixedReviewResort +
    editableRows
      .filter((s) => choices[s.oldNodeId] === RESORT)
      .reduce((sum, s) => sum + s.threadCount, 0);

  function confirm() {
    // Only editable choices are sent; the server always forces catch-all → catch-all.
    onConfirm({ ...choices });
  }

  return (
    <div
      className="tx-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !submitting) onCancel();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="tx-modal">
        <div className="tx-modal-head">
          <h2 className="tx-modal-title">
            <Trans>Replace folders</Trans>
          </h2>
          <button
            type="button"
            className="tx-modal-close"
            aria-label={_(msg`Cancel`)}
            onClick={onCancel}
            disabled={submitting}
          >
            ✕
          </button>
        </div>

        <div className="tx-modal-body">
          <p className="tx-lead">
            <Trans>
              Choose where each folder&rsquo;s threads should go under your new folders. Matched
              folders keep their threads instantly; anything set to re-sort is re-classified by
              AI.
            </Trans>
          </p>

          {editableRows.length === 0 && !catchAllRow && (
            <p className="tx-hint">
              <Trans>No sorted threads to migrate. Your new folders will apply directly.</Trans>
            </p>
          )}

          <div className="tx-rows">
            {editableRows.map((s) => (
              <div key={s.oldNodeId} className="tx-row">
                <div className="tx-row-name">
                  <div className="tx-row-label">{s.oldName}</div>
                  <div className="tx-row-count">
                    <Plural value={s.threadCount} one="# thread" other="# threads" />
                  </div>
                </div>
                <select
                  className="tx-select"
                  value={choices[s.oldNodeId] ?? RESORT}
                  disabled={submitting}
                  aria-label={s.oldName}
                  onChange={(e) => setChoices((c) => ({ ...c, [s.oldNodeId]: e.target.value }))}
                >
                  <option value={RESORT}>{_(msg`Re-sort with AI`)}</option>
                  {newFolders.map((f) => (
                    <option key={f.ref} value={f.ref}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {catchAllRow && (
            <p className="tx-hint">
              <Trans>
                Automated and bulk mail ({catchAllRow.threadCount}) always moves to the new
                catch-all folder.
              </Trans>
            </p>
          )}

          {hiddenCount > 0 && (
            <p className="tx-hint">
              <Plural
                value={hiddenCount}
                one="# folder with no threads is not shown."
                other="# folders with no threads are not shown."
              />
            </p>
          )}

          <div className="tx-summary">
            <p>
              <Trans>
                {migrateLive > 0 ? (
                  <Fragment>
                    <strong>{migrateLive}</strong> threads move to their new folder instantly.{" "}
                  </Fragment>
                ) : null}
                <strong>{resortLive}</strong> threads will be re-sorted by AI.
              </Trans>
            </p>
            <p>
              <Trans>
                Re-sorting threads already sorted this month is free. If you reach your monthly
                limit, the rest resume next month.
              </Trans>
            </p>
          </div>
        </div>

        <div className="tx-modal-foot">
          <button
            type="button"
            className="tx-btn tx-btn--primary"
            onClick={confirm}
            disabled={submitting}
          >
            <Trans>Migrate &amp; apply</Trans>
          </button>
          <button
            type="button"
            className="tx-btn tx-btn--ghost"
            onClick={onCancel}
            disabled={submitting}
          >
            <Trans>Cancel</Trans>
          </button>
        </div>
      </div>
    </div>
  );
}
