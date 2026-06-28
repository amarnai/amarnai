"use client";

import { useActionState } from "react";
import { updateWorkspaceNameAction } from "@/actions/workspace";
import { Trans } from "@lingui/react/macro";

export function WorkspaceNameSection({ currentName }: { currentName: string }) {
  const [state, formAction, pending] = useActionState(updateWorkspaceNameAction, null);

  return (
    <section className="settings-section">
      <h2><Trans>Workspace Details</Trans></h2>
      <form action={formAction} className="settings-form">
        <div className="form-group">
          <label htmlFor="ws-name" className="form-label"><Trans>Name</Trans></label>
          <input
            id="ws-name"
            name="name"
            type="text"
            className="form-input"
            defaultValue={currentName}
            maxLength={100}
            required
          />
        </div>
        {state?.error && <p className="auth-error">{state.error}</p>}
        {state?.success && <p className="auth-success"><Trans>Workspace name updated.</Trans></p>}
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
        </button>
      </form>
    </section>
  );
}
