"use client";

import { useActionState } from "react";
import Link from "next/link";
import { PASSWORD_MIN_LENGTH } from "@amarnai/shared";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { registerAction } from "@/actions/auth";
import { AuthShell } from "@/components/AuthShell";
import { GoogleButton } from "@/components/GoogleButton";

export function SignUpForm({
  defaultEmail,
  invited = false,
}: {
  defaultEmail?: string | undefined;
  invited?: boolean;
}) {
  const { _ } = useLingui();
  const [state, action, pending] = useActionState(registerAction, null);

  return (
    <AuthShell title={_( msg`Create your account`)}>
      {invited && (
        <p className="auth-success">
          <Trans>Create your account to accept your workspace invitation.</Trans>
        </p>
      )}
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
            defaultValue={defaultEmail}
            className="form-input"
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="password">
            <Trans>Password</Trans>
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            className="form-input"
          />
          <p className="auth-hint"><Trans>At least {PASSWORD_MIN_LENGTH} characters</Trans></p>
        </div>

        <button type="submit" disabled={pending} className="btn-primary auth-submit">
          {pending ? _( msg`Creating account…`) : _( msg`Create account`)}
        </button>
      </form>

      <div className="auth-divider">
        <span><Trans>or</Trans></span>
      </div>

      <GoogleButton label={_( msg`Sign up with Google`)} />

      <p className="auth-switch">
        <Trans>
          Already have an account?{" "}
          <Link href="/sign-in" className="auth-link">
            Sign in
          </Link>
        </Trans>
      </p>
    </AuthShell>
  );
}
