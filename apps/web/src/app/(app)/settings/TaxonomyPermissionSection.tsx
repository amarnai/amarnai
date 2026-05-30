"use client";

import { useState, useTransition } from "react";
import { updateTaxonomyPermissionAction } from "@/actions/members";

type Props = {
  initialCanEdit: boolean;
};

export function TaxonomyPermissionSection({ initialCanEdit }: Props) {
  const [canEdit, setCanEdit] = useState(initialCanEdit);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleToggle(checked: boolean) {
    setCanEdit(checked);
    setError(null);
    startTransition(async () => {
      const result = await updateTaxonomyPermissionAction(checked);
      if (result.error) {
        setCanEdit(!checked);
        setError(result.error);
      }
    });
  }

  return (
    <section className="settings-section">
      <h2>Team permissions</h2>

      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={canEdit}
          onChange={(e) => handleToggle(e.target.checked)}
          disabled={isPending}
        />
        Allow team members to edit the taxonomy
      </label>

      <p className="settings-hint">
        {canEdit ? (
          <>
            Team members can create, edit, and delete taxonomy nodes.{" "}
            <strong>Note:</strong> concurrent editing is not supported — only one person should
            edit the taxonomy at a time to avoid conflicting changes.
          </>
        ) : (
          "Team members can view the taxonomy but cannot make changes. Only you (the admin) can edit it."
        )}
      </p>

      {error && <p className="auth-error">{error}</p>}
    </section>
  );
}
