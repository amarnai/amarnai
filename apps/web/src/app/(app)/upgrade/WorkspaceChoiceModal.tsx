"use client";

import { useEffect, useRef, useState } from "react";
import { OptionCards, type OptionCardItem } from "@amarnai/ui";

type Choice = "upgrade" | "create";

interface Props {
  workspaceName: string;
  onClose: () => void;
  onUpgradeCurrentWorkspace: () => void;
  onCreatePaidWorkspace: () => void;
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
    description:
      "Use this plan for a business, team, or separate Gmail account.",
  },
];

export function WorkspaceChoiceModal({
  workspaceName,
  onClose,
  onUpgradeCurrentWorkspace,
  onCreatePaidWorkspace,
}: Props) {
  const [selected, setSelected] = useState<Choice | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleContinue() {
    if (selected === "upgrade") onUpgradeCurrentWorkspace();
    else if (selected === "create") onCreatePaidWorkspace();
  }

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === backdropRef.current) onClose();
  }

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
            Current workspace:{" "}
            <strong>{workspaceName}</strong>
          </p>

          <OptionCards
            options={OPTIONS}
            selected={selected}
            onChange={setSelected}
          />

          <p className="ws-choice-helper">
            You can keep your free Personal workspace and use paid workspaces
            separately.
          </p>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={selected === null}
            onClick={handleContinue}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
