"use client";

import { useActionState, useState, useTransition } from "react";
import {
  updateNameAction,
  deleteAccountAction,
  signOutAction,
  setLifecycleEmailsAction,
  setLocaleAction,
} from "@/actions/auth";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import {
  SUPPORTED_LOCALES,
  LOCALE_DISPLAY_NAMES,
  isSupportedLocale,
  type SupportedLocale,
} from "@amarnai/i18n";

export function AccountForm({
  currentName,
  email,
  lifecycleEmailsEnabled,
  locale,
}: {
  currentName: string | null;
  email: string;
  lifecycleEmailsEnabled: boolean;
  locale: string;
}) {
  const { _ } = useLingui();
  const [nameValue, setNameValue] = useState(currentName ?? "");
  const [nameState, nameAction, namePending] = useActionState(updateNameAction, null);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteAccountAction, null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Instant-save toggle (no separate Save button) to keep the interaction to a
  // single click. Optimistic local state reverts if the action fails.
  const [remindersEnabled, setRemindersEnabled] = useState(lifecycleEmailsEnabled);
  const [remindersPending, startReminders] = useTransition();

  const currentLocale: SupportedLocale = isSupportedLocale(locale) ? locale : "en";
  const [selectedLocale, setSelectedLocale] = useState<SupportedLocale>(currentLocale);
  const [localePending, startLocale] = useTransition();

  function changeLocale(next: SupportedLocale) {
    setSelectedLocale(next);
    startLocale(async () => {
      const result = await setLocaleAction(next);
      if (result?.error) setSelectedLocale(currentLocale);
    });
  }

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
        <h2><Trans>Profile</Trans></h2>

        <form action={nameAction} className="account-form">
          {nameState?.error && <p className="auth-error">{nameState.error}</p>}
          {nameState?.success && <p className="auth-success"><Trans>Name updated.</Trans></p>}

          <div className="form-group">
            <label className="form-label" htmlFor="name">
              <Trans>Display name</Trans>
            </label>
            <input
              id="name"
              name="name"
              type="text"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              placeholder={_(msg`Your name`)}
              maxLength={100}
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label className="form-label"><Trans>Email</Trans></label>
            <input type="email" value={email} readOnly disabled className="form-input" />
          </div>

          <button type="submit" disabled={namePending} className="btn-primary">
            {namePending ? <Trans>Saving…</Trans> : <Trans>Save changes</Trans>}
          </button>
        </form>
      </section>

      <section className="settings-section">
        <h2><Trans>Email reminders</Trans></h2>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={remindersEnabled}
            disabled={remindersPending}
            onChange={(e) => toggleReminders(e.target.checked)}
          />
          <Trans>Send me a weekly reminder when my Amarnai inbox needs attention.</Trans>
        </label>
      </section>

      <section className="settings-section">
        <h2><Trans>Language</Trans></h2>
        <div className="form-group">
          <label className="form-label" htmlFor="locale">
            <Trans>Display language</Trans>
          </label>
          <select
            id="locale"
            className="form-input"
            value={selectedLocale}
            disabled={localePending}
            onChange={(e) => {
              const val = e.target.value;
              if (isSupportedLocale(val)) changeLocale(val);
            }}
          >
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_DISPLAY_NAMES[l]}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="settings-section">
        <h2><Trans>Session</Trans></h2>
        <form action={signOutAction}>
          <button type="submit" className="btn-secondary">
            <Trans>Sign out</Trans>
          </button>
        </form>
      </section>

      <section className="settings-section settings-section-danger">
        <h2><Trans>Danger zone</Trans></h2>
        <p className="account-danger-description">
          <Trans>Permanently delete your account and all associated data. This cannot be undone.</Trans>
        </p>

        {deleteState?.error && <p className="auth-error">{deleteState.error}</p>}

        {!confirmDelete ? (
          <button
            type="button"
            className="btn-danger"
            onClick={() => setConfirmDelete(true)}
          >
            <Trans>Delete account</Trans>
          </button>
        ) : (
          <form action={deleteAction} className="account-delete-confirm">
            <p className="account-danger-warning">
              <Trans>All your workspaces, emails, and settings will be deleted permanently.</Trans>
            </p>
            <div className="account-delete-actions">
              <button type="submit" disabled={deletePending} className="btn-danger">
                {deletePending ? <Trans>Deleting…</Trans> : <Trans>Yes, delete my account</Trans>}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setConfirmDelete(false)}
              >
                <Trans>Cancel</Trans>
              </button>
            </div>
          </form>
        )}
      </section>
    </>
  );
}
