"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { resetPasswordAction } from "@/actions/auth";
import { AuthShell } from "@/components/AuthShell";

function ResetPasswordForm() {
  const { _ } = useLingui();
  const token = useSearchParams().get("token") ?? "";
  const [state, action, pending] = useActionState(resetPasswordAction, null);

  if (state?.success) {
    return (
      <>
        <p className="auth-success"><Trans>Password updated! You can now sign in.</Trans></p>
        <p className="auth-switch">
          <Link href="/sign-in" className="auth-link">
            <Trans>Go to sign in</Trans>
          </Link>
        </p>
      </>
    );
  }

  if (!token) {
    return <p className="auth-error"><Trans>Invalid or missing reset link.</Trans></p>;
  }

  return (
    <form action={action} className="auth-form">
      {state?.error && <p className="auth-error">{state.error}</p>}
      <input type="hidden" name="token" value={token} />

      <div className="form-group">
        <label className="form-label" htmlFor="password">
          <Trans>New password</Trans>
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="form-input"
        />
        <p className="auth-hint"><Trans>At least 8 characters</Trans></p>
      </div>

      <button type="submit" disabled={pending} className="btn-primary auth-submit">
        {pending ? _( msg`Updating…`) : _( msg`Set new password`)}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  const { _ } = useLingui();
  return (
    <AuthShell
      title={_( msg`New password`)}
      subtitle={_( msg`Choose a new password for your account.`)}
    >
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
