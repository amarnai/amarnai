"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { credentialsSignInAction } from "@/actions/auth";
import { AuthShell } from "@/components/AuthShell";
import { GoogleButton } from "@/components/GoogleButton";

function SignInContent() {
  const searchParams = useSearchParams();
  const [state, action, pending] = useActionState(credentialsSignInAction, null);

  const verified = searchParams.get("verified") === "1";
  const passwordReset = searchParams.get("password_reset") === "1";
  const tokenError = searchParams.get("error") === "invalid_token";

  return (
    <AuthShell title="Sign in" subtitle="AI email triage assistant">
      {verified && <p className="auth-success">Email verified! Sign in to continue.</p>}
      {passwordReset && (
        <p className="auth-success">Password updated. Sign in with your new password.</p>
      )}
      {tokenError && <p className="auth-error">That link is invalid or has expired.</p>}

      <form action={action} className="auth-form">
        {state?.error && <p className="auth-error">{state.error}</p>}

        <div className="form-group">
          <label className="form-label" htmlFor="email">
            Email
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
              Password
            </label>
            <Link href="/forgot-password" className="auth-link auth-forgot">
              Forgot password?
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
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="auth-divider">
        <span>or</span>
      </div>

      <GoogleButton />

      <p className="auth-switch">
        Don&apos;t have an account?{" "}
        <Link href="/sign-up" className="auth-link">
          Sign up
        </Link>
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
