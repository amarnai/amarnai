"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { forgotPasswordAction } from "@/actions/auth";
import { AuthShell } from "@/components/AuthShell";

export default function ForgotPasswordPage() {
  const { _ } = useLingui();
  const [state, action, pending] = useActionState(forgotPasswordAction, null);

  return (
    <AuthShell
      title={_( msg`Reset password`)}
      {...(!state?.success && { subtitle: _( msg`Enter your email and we'll send you a reset link.`) })}
    >
      {state?.success ? (
        <p className="auth-success">
          <Trans>We've sent a link to {state.email}. Follow it to reset your password.</Trans>
        </p>
      ) : (
        <form action={action} className="auth-form">
          {state?.error && <p className="auth-error">{state.error}</p>}

          <div className="form-group">
            <label className="form-label" htmlFor="email">
              <Trans>Email</Trans>
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="form-input"
            />
          </div>

          <button type="submit" disabled={pending} className="btn-primary auth-submit">
            {pending ? _( msg`Sending…`) : _( msg`Send reset link`)}
          </button>
        </form>
      )}

      <p className="auth-switch">
        <Link href="/sign-in" className="auth-link">
          <Trans>Back to sign in</Trans>
        </Link>
      </p>
    </AuthShell>
  );
}
