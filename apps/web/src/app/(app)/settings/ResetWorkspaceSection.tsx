"use client";

import { useState } from "react";
import { resetWorkspaceAction } from "@/actions/workspace";
import { Trans } from "@lingui/react/macro";
import { getDraftQuotaResetsAt, formatQuotaResetDate } from "@amarnai/shared";

export function ResetWorkspaceSection({ workspaceId }: { workspaceId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Date the monthly import allowance next refreshes (calendar-month rollover).
  const allowanceResetsAt = formatQuotaResetDate(getDraftQuotaResetsAt(new Date()).toISOString());

  async function handleReset() {
    setPending(true);
    setError(null);
    const result = await resetWorkspaceAction(workspaceId);
    if (result?.error) {
      setError(result.error);
      setPending(false);
      setConfirming(false);
    }
    // On success, the action redirects
  }

  return (
    <section className="settings-section settings-section-danger">
      <h2><Trans>Reset workspace</Trans></h2>
      <p className="account-danger-description">
        <Trans>
          Remove the Gmail connection, delete all synced emails, and reset the
          taxonomy to Inbox only. Your workspace and account are kept. This
          cannot be undone.
        </Trans>
      </p>

      {error && <p className="auth-error">{error}</p>}

      {!confirming ? (
        <button
          type="button"
          className="btn-danger"
          onClick={() => setConfirming(true)}
        >
          <Trans>Reset workspace</Trans>
        </button>
      ) : (
        <div className="account-delete-confirm">
          <p className="account-danger-warning">
            <Trans>
              The Gmail connection, all synced emails, and the taxonomy will be
              permanently deleted. Re-importing this inbox uses your monthly
              import allowance; if it runs out, you can import again after{" "}
              {allowanceResetsAt} or by upgrading.
            </Trans>
          </p>
          <div className="account-delete-actions">
            <button
              type="button"
              className="btn-danger"
              onClick={handleReset}
              disabled={pending}
            >
              {pending ? <Trans>Resetting…</Trans> : <Trans>Yes, reset workspace</Trans>}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              <Trans>Cancel</Trans>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
