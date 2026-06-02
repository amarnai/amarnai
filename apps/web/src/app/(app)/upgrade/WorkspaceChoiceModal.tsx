"use client";

import { useEffect, useRef, useState } from "react";
import { OptionCards, type OptionCardItem } from "@amarnai/ui";
import type { PlanId, BillingCycle } from "@amarnai/ui";

type Choice = "upgrade" | "create";

interface Props {
  workspaceId: string;
  workspaceName: string;
  plan: PlanId;
  cycle: BillingCycle;
  onClose: () => void;
}

const OPTIONS: OptionCardItem<Choice>[] = [
  {
    id: "upgrade",
    label: "Upgrade this workspace",
    description: "Keep your current inbox, taxonomy, and sorting history.",
  },
  {
    id: "create",
    label: "Create a new workspace",
    description: "Use this plan for a business, team, or separate Gmail account.",
  },
];

export function WorkspaceChoiceModal({
  workspaceId,
  workspaceName,
  plan,
  cycle,
  onClose,
}: Props) {
  const [selected, setSelected] = useState<Choice | null>(null);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === backdropRef.current) onClose();
  }

  async function handleContinue() {
    if (!selected) return;
    if (selected === "create" && !newName.trim()) {
      setError("Workspace name cannot be empty");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: selected,
          plan,
          cycle,
          workspaceId: selected === "upgrade" ? workspaceId : undefined,
          newWorkspaceName: selected === "create" ? newName.trim() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      if (data.upgraded) {
        window.location.href = "/settings";
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const canContinue =
    selected !== null &&
    (selected !== "create" || newName.trim().length > 0) &&
    !loading;

  return (
    <div
      ref={backdropRef}
      className="modal-backdrop"
      onClick={handleBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ws-choice-title"
        className="modal"
      >
        <div className="modal-header">
          <h2 id="ws-choice-title" className="modal-title">
            How do you want to use this plan?
          </h2>
          <button
            type="button"
            className="modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          <p className="ws-choice-helper">
            Current workspace: <strong>{workspaceName}</strong>
          </p>

          <OptionCards
            options={OPTIONS}
            selected={selected}
            onChange={setSelected}
          />

          {selected === "create" && (
            <input
              className="ws-create-input"
              type="text"
              placeholder="New workspace name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={100}
              autoFocus
            />
          )}

          {error && <p className="ws-choice-error">{error}</p>}

          <p className="ws-choice-helper">
            You can keep your free Personal workspace and use paid workspaces
            separately.
          </p>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!canContinue}
            onClick={handleContinue}
          >
            {loading ? "Redirecting…" : "Continue to payment"}
          </button>
        </div>
      </div>
    </div>
  );
}
