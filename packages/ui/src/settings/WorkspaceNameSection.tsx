"use client";

import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { ApiClient } from "@aziru/api-client";
import "./settings.css";

export type WorkspaceNameSectionProps = {
  api: ApiClient;
  workspaceId: string;
  currentName: string;
  /**
   * The name changed. Hosts use this for their own refresh side effects: the web
   * app revalidates its layout, the panel re-pulls its workspace list so the
   * switcher relabels.
   */
  onSaved?: (name: string) => void;
};

export function WorkspaceNameSection({
  api,
  workspaceId,
  currentName,
  onSaved,
}: WorkspaceNameSectionProps) {
  const { _ } = useLingui();
  const [name, setName] = useState(currentName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || pending) return;

    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api.updateWorkspace(workspaceId, { name: trimmed });
      setName(updated.name);
      setSaved(true);
      onSaved?.(updated.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : _(msg`Could not save. Please try again.`));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="st-section">
      <h2 className="st-title">
        <Trans>Workspace details</Trans>
      </h2>
      <form className="st-field" onSubmit={handleSubmit}>
        <label className="st-label" htmlFor="st-ws-name">
          <Trans>Name</Trans>
        </label>
        <input
          id="st-ws-name"
          className="st-input"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          maxLength={100}
          required
        />
        {error && (
          <p className="st-error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="st-ok">
            <Trans>Workspace name updated.</Trans>
          </p>
        )}
        <div className="st-actions">
          <button
            type="submit"
            className="st-btn st-btn--primary"
            disabled={pending || !name.trim() || name.trim() === currentName}
          >
            {pending ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
          </button>
        </div>
      </form>
    </section>
  );
}
