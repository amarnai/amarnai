"use client";

import { useActionState } from "react";
import { updateWorkspaceNameAction } from "@/actions/workspace";

export function WorkspaceNameSection({ currentName }: { currentName: string }) {
  const [state, formAction, pending] = useActionState(updateWorkspaceNameAction, null);

  return (
    <section className="settings-section">
      <h2>Workspace Name</h2>
      <form action={formAction} className="settings-form">
        <div className="form-group">
          <label htmlFor="ws-name" className="form-label">Name</label>
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
        {state?.success && <p className="auth-success">Workspace name updated.</p>}
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
      </form>
    </section>
  );
}
