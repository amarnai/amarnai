"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { credentialsSignInAction, signOutAction } from "@/actions/auth";
import { AuthShell } from "@/components/AuthShell";
import { GoogleButton } from "@/components/GoogleButton";

function SignInContent() {
  const { _ } = useLingui();
  const searchParams = useSearchParams();
  const [state, action, pending] = useActionState(credentialsSignInAction, null);

  const verified = searchParams.get("verified") === "1";
  const passwordReset = searchParams.get("password_reset") === "1";
  const errorParam = searchParams.get("error");
  const tokenError = errorParam === "invalid_token";
  const invalidInvite = errorParam === "invalid_invite";
  const wrongAccount = errorParam === "invite_wrong_account";
  const inviteEmail = searchParams.get("email");
  const invitePrompt = searchParams.get("invite") === "1";

  return (
    <AuthShell title={_( msg`Sign in`)} subtitle={_( msg`AI email triage assistant`)}>
      {verified && (
        <p className="auth-success">
          <Trans>Email verified! Sign in to continue.</Trans>
        </p>
      )}
      {passwordReset && (
        <p className="auth-success">
          <Trans>Password updated. Sign in with your new password.</Trans>
        </p>
      )}
      {invitePrompt && (
        <p className="auth-success">
          <Trans>Sign in to accept your workspace invitation.</Trans>
        </p>
      )}
      {invalidInvite && (
        <p className="auth-error">
          <Trans>That invitation link is invalid or has expired.</Trans>
        </p>
      )}
      {wrongAccount && (
        <div className="auth-error">
          {inviteEmail ? (
            <Trans>This invitation was sent to {inviteEmail}. Sign in with that account to accept it.</Trans>
          ) : (
            <Trans>This invitation was sent to a different account. Sign in with that account to accept it.</Trans>
          )}
          <form action={signOutAction}>
            <button type="submit" className="auth-link">
              <Trans>Sign out of the current account</Trans>
            </button>
          </form>
        </div>
      )}
      {tokenError && (
        <p className="auth-error">
          <Trans>That link is invalid or has expired.</Trans>
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
            className="form-input"
          />
        </div>

        <div className="form-group">
          <div className="auth-label-row">
            <label className="form-label" htmlFor="password">
              <Trans>Password</Trans>
            </label>
            <Link href="/forgot-password" className="auth-link auth-forgot">
              <Trans>Forgot password?</Trans>
            </Link>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="form-input"
          />
        </div>

        <button type="submit" disabled={pending} className="btn-primary auth-submit">
          {pending ? <Trans>Signing in…</Trans> : <Trans>Sign in</Trans>}
        </button>
      </form>

      <div className="auth-divider">
        <span>
          <Trans>or</Trans>
        </span>
      </div>

      <GoogleButton />

      <p className="auth-switch">
        <Trans>
          Don&apos;t have an account?{" "}
          <Link href="/sign-up" className="auth-link">
            Sign up
          </Link>
        </Trans>
      </p>
    </AuthShell>
  );
}

export function SignInForm() {
  return (
    <Suspense>
      <SignInContent />
    </Suspense>
  );
}
