"use client";

import { useActionState, useState, useTransition } from "react";
import {
  updateNameAction,
  deleteAccountAction,
  signOutAction,
  setLifecycleEmailsAction,
} from "@/actions/auth";

export function AccountForm({
  currentName,
  email,
  lifecycleEmailsEnabled,
}: {
  currentName: string | null;
  email: string;
  lifecycleEmailsEnabled: boolean;
}) {
  const [nameValue, setNameValue] = useState(currentName ?? "");
  const [nameState, nameAction, namePending] = useActionState(updateNameAction, null);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteAccountAction, null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Instant-save toggle (no separate Save button) to keep the interaction to a
  // single click. Optimistic local state reverts if the action fails.
  const [remindersEnabled, setRemindersEnabled] = useState(lifecycleEmailsEnabled);
  const [remindersPending, startReminders] = useTransition();

  function toggleReminders(next: boolean) {
    setRemindersEnabled(next);
    startReminders(async () => {
      const result = await setLifecycleEmailsAction(next);
      if (result?.error) setRemindersEnabled(!next); // revert on failure
    });
  }

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
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
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
        <h2>Email reminders</h2>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={remindersEnabled}
            disabled={remindersPending}
            onChange={(e) => toggleReminders(e.target.checked)}
          />
          Send me a weekly reminder when my Amarnai inbox needs attention.
        </label>
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
