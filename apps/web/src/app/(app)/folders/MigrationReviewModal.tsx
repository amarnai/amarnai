"use client";

import { Fragment, useMemo, useState } from "react";
import { Trans, Plural } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { TaxonomyTransferFile } from "@amarnai/shared";
import type {
  TaxonomyImportPreviewResult,
  TaxonomyMigrationMapping,
} from "@/lib/api";

const RESORT = "resort" as const;

type Props = {
  file: TaxonomyTransferFile;
  preview: TaxonomyImportPreviewResult;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (mapping: TaxonomyMigrationMapping) => void;
};

/**
 * Pre-apply review for replacing the taxonomy. Shows, per old folder that holds
 * threads, whether those threads carry over to a matched new folder or get
 * re-sorted by AI — with editable defaults. One click on "Migrate & apply"
 * accepts the auto-matched defaults.
 */
export function MigrationReviewModal({
  file,
  preview,
  submitting,
  onCancel,
  onConfirm,
}: Props) {
  const { _ } = useLingui();

  // New (incoming) non-root folders, minus the catch-all (never a manual target).
  const newFolders = useMemo(
    () =>
      file.nodes
        .filter((n) => !n.isRoot && !(n.isCatchAll ?? false))
        .map((n) => ({ ref: n.ref, name: n.name })),
    [file],
  );

  // Rows with threads, catch-all shown but locked. Zero-thread folders are hidden.
  const rows = useMemo(
    () => preview.suggestions.filter((s) => s.threadCount > 0),
    [preview],
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
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !submitting) onCancel();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h2 className="modal-title">
            <Trans>Replace folders</Trans>
          </h2>
          <button
            className="modal-close"
            aria-label={_(msg`Cancel`)}
            onClick={onCancel}
            disabled={submitting}
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p style={{ marginBottom: 12 }}>
            <Trans>
              Choose where each folder&rsquo;s threads should go under your new
              folders. Matched folders keep their threads instantly; anything
              set to re-sort is re-classified by AI.
            </Trans>
          </p>

          {editableRows.length === 0 && !catchAllRow && (
            <p style={{ color: "var(--color-muted)", fontSize: 13 }}>
              <Trans>
                No sorted threads to migrate. Your new folders will apply
                directly.
              </Trans>
            </p>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {editableRows.map((s) => (
              <div
                key={s.oldNodeId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.oldName}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-muted)" }}>
                    <Plural
                      value={s.threadCount}
                      one="# thread"
                      other="# threads"
                    />
                  </div>
                </div>
                <select
                  className="form-select"
                  style={{ maxWidth: 240 }}
                  value={choices[s.oldNodeId] ?? RESORT}
                  disabled={submitting}
                  onChange={(e) =>
                    setChoices((c) => ({ ...c, [s.oldNodeId]: e.target.value }))
                  }
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
            <p
              style={{
                fontSize: 11,
                color: "var(--color-muted)",
                marginTop: 10,
              }}
            >
              <Trans>
                Automated and bulk mail ({catchAllRow.threadCount}) always moves
                to the new catch-all folder.
              </Trans>
            </p>
          )}

          {hiddenCount > 0 && (
            <p
              style={{
                fontSize: 11,
                color: "var(--color-muted)",
                marginTop: 6,
              }}
            >
              <Plural
                value={hiddenCount}
                one="# folder with no threads is not shown."
                other="# folders with no threads are not shown."
              />
            </p>
          )}

          <div
            style={{
              marginTop: 14,
              fontSize: 13,
              padding: "10px 12px",
              borderRadius: 8,
              background:
                "var(--color-surface-2, var(--color-muted-bg, rgba(0,0,0,0.04)))",
            }}
          >
            <p style={{ margin: 0 }}>
              <Trans>
                {migrateLive > 0 ? (
                  <Fragment>
                    <strong>{migrateLive}</strong> threads move to their new
                    folder instantly.{" "}
                  </Fragment>
                ) : null}
                <strong>{resortLive}</strong> threads will be re-sorted by AI.
              </Trans>
            </p>
            <p
              style={{
                margin: "6px 0 0",
                color: "var(--color-muted)",
                fontSize: 12,
              }}
            >
              <Trans>
                Re-sorting threads already sorted this month is free. If you
                reach your monthly limit, the rest resume next month.
              </Trans>
            </p>
          </div>
        </div>

        <div className="modal-footer">
          <button
            className="btn-ghost"
            onClick={onCancel}
            disabled={submitting}
          >
            <Trans>Cancel</Trans>
          </button>
          <button
            className="btn-primary"
            onClick={confirm}
            disabled={submitting}
          >
            <Trans>Migrate &amp; apply</Trans>
          </button>
        </div>
      </div>
    </div>
  );
}
