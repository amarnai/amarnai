"use client";

import { useActionState, useState } from "react";
import { updateNameAction, deleteAccountAction, signOutAction } from "@/actions/auth";

export function AccountForm({ currentName, email }: { currentName: string | null; email: string }) {
  const [nameState, nameAction, namePending] = useActionState(updateNameAction, null);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteAccountAction, null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <>
      <section className="settings-section">
        <h2>Profile</h2>

        <form action={nameAction} className="account-form">
          {nameState?.error && <p className="auth-error">{nameState.error}</p>}
          {nameState?.success && <p className="auth-success">Name updated.</p>}

          <div className="form-group">
            <label className="form-label" htmlFor="name">
              Display name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              defaultValue={currentName ?? ""}
              placeholder="Your name"
              maxLength={100}
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Email</label>
            <input type="email" value={email} readOnly disabled className="form-input" />
          </div>

          <button type="submit" disabled={namePending} className="btn-primary">
            {namePending ? "Saving…" : "Save changes"}
          </button>
        </form>
      </section>

      <section className="settings-section">
        <h2>Session</h2>
        <form action={signOutAction}>
          <button type="submit" className="btn-secondary">
            Sign out
          </button>
        </form>
      </section>

      <section className="settings-section settings-section-danger">
        <h2>Danger zone</h2>
        <p className="account-danger-description">
          Permanently delete your account and all associated data. This cannot be undone.
        </p>

        {deleteState?.error && <p className="auth-error">{deleteState.error}</p>}

        {!confirmDelete ? (
          <button
            type="button"
            className="btn-danger"
            onClick={() => setConfirmDelete(true)}
          >
            Delete account
          </button>
        ) : (
          <form action={deleteAction} className="account-delete-confirm">
            <p className="account-danger-warning">
              All your workspaces, emails, and settings will be deleted permanently.
            </p>
            <div className="account-delete-actions">
              <button type="submit" disabled={deletePending} className="btn-danger">
                {deletePending ? "Deleting…" : "Yes, delete my account"}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>
    </>
  );
}
