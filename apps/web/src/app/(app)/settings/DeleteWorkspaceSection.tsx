"use client";

import { useState } from "react";
import { deleteWorkspaceAction } from "@/actions/workspace";

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
      <h2>Delete workspace</h2>
      <p className="account-danger-description">
        Permanently delete this workspace and all of its data — emails, plan,
        settings, and Gmail connection. This cannot be undone.
      </p>

      {error && <p className="auth-error">{error}</p>}

      {!confirming ? (
        <button
          type="button"
          className="btn-danger"
          onClick={() => setConfirming(true)}
        >
          Delete workspace
        </button>
      ) : (
        <div className="account-delete-confirm">
          <p className="account-danger-warning">
            All workspace data will be permanently deleted.
          </p>
          <div className="account-delete-actions">
            <button
              type="button"
              className="btn-danger"
              onClick={handleDelete}
              disabled={pending}
            >
              {pending ? "Deleting…" : "Yes, delete workspace"}
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
