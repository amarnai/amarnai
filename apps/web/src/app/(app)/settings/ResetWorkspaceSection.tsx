"use client";

import { useState } from "react";
import { resetWorkspaceAction } from "@/actions/workspace";

export function ResetWorkspaceSection({ workspaceId }: { workspaceId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <h2>Reset workspace</h2>
      <p className="account-danger-description">
        Remove the Gmail connection, delete all synced emails, and reset the
        taxonomy to Inbox only. Your workspace and account are kept. This
        cannot be undone.
      </p>

      {error && <p className="auth-error">{error}</p>}

      {!confirming ? (
        <button
          type="button"
          className="btn-danger"
          onClick={() => setConfirming(true)}
        >
          Reset workspace
        </button>
      ) : (
        <div className="account-delete-confirm">
          <p className="account-danger-warning">
            The Gmail connection, all synced emails, and the taxonomy will be
            permanently deleted.
          </p>
          <div className="account-delete-actions">
            <button
              type="button"
              className="btn-danger"
              onClick={handleReset}
              disabled={pending}
            >
              {pending ? "Resetting…" : "Yes, reset workspace"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
