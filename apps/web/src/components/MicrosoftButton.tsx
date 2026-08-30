"use client";

import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { microsoftSignInAction } from "@/actions/auth";
import { MicrosoftIcon } from "@aziru/ui";

export function MicrosoftButton({ label }: { label?: string }) {
  const { _ } = useLingui();
  const defaultLabel = _( msg`Continue with Microsoft`);
  return (
    <form action={microsoftSignInAction}>
      <button className="btn-microsoft" type="submit">
        <MicrosoftIcon />
        {label ?? defaultLabel}
      </button>
    </form>
  );
}
