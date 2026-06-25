"use client";

import { useState } from "react";
import { deleteWorkspaceAction } from "@/actions/workspace";
import { Trans } from "@lingui/react/macro";

export function DeleteWorkspaceSection({ workspaceId }: { workspaceId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setPending(true);
    setError(null);
    const result = await deleteWorkspaceAction(workspaceId);
    if (result?.error) {
      setError(result.error);
      setPending(false);
      setConfirming(false);
    }
    // On success, the action redirects
  }

  return (
    <section className="settings-section settings-section-danger">
      <h2><Trans>Delete workspace</Trans></h2>
      <p className="account-danger-description">
        <Trans>
          Permanently delete this workspace and all of its data: emails, plan,
          settings, and Gmail connection. This cannot be undone.
        </Trans>
      </p>

      {error && <p className="auth-error">{error}</p>}

      {!confirming ? (
        <button
          type="button"
          className="btn-danger"
          onClick={() => setConfirming(true)}
        >
          <Trans>Delete workspace</Trans>
        </button>
      ) : (
        <div className="account-delete-confirm">
          <p className="account-danger-warning">
            <Trans>All workspace data will be permanently deleted.</Trans>
          </p>
          <div className="account-delete-actions">
            <button
              type="button"
              className="btn-danger"
              onClick={handleDelete}
              disabled={pending}
            >
              {pending ? <Trans>Deleting…</Trans> : <Trans>Yes, delete workspace</Trans>}
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
