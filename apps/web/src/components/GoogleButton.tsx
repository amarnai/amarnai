"use client";

import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { googleSignInAction } from "@/actions/auth";
import { GoogleGIcon } from "@aziru/ui";

export function GoogleButton({ label }: { label?: string }) {
  const { _ } = useLingui();
  const defaultLabel = _( msg`Continue with Google`);
  return (
    <form action={googleSignInAction}>
      <button className="btn-google" type="submit">
        <GoogleGIcon />
        {label ?? defaultLabel}
      </button>
    </form>
  );
}
