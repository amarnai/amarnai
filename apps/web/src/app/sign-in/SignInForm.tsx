"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { credentialsSignInAction, googleSignInAction } from "@/actions/auth";

function SignInContent() {
  const searchParams = useSearchParams();
  const [state, action, pending] = useActionState(credentialsSignInAction, null);

  const verified = searchParams.get("verified") === "1";
  const passwordReset = searchParams.get("password_reset") === "1";
  const tokenError = searchParams.get("error") === "invalid_token";

  return (
    <div className="sign-in-page">
      <div className="sign-in-card">
        <h1 className="sign-in-title">Amarnai</h1>
        <p className="sign-in-subtitle">AI email triage assistant</p>

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

        <form action={googleSignInAction}>
          <button className="btn-google" type="submit">
            Sign in with Google
          </button>
        </form>

        <p className="auth-switch">
          Don&apos;t have an account?{" "}
          <Link href="/sign-up" className="auth-link">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}

export function SignInForm() {
  return (
    <Suspense>
      <SignInContent />
    </Suspense>
  );
}
