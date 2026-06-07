"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { credentialsSignInAction, googleSignInAction } from "@/actions/auth";
import { AuthShell } from "@/components/AuthShell";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

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

      <form action={googleSignInAction}>
        <button className="btn-google" type="submit">
          <GoogleIcon />
          Continue with Google
        </button>
      </form>

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
