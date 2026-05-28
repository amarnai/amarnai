"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { resetPasswordAction } from "@/actions/auth";

function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const [state, action, pending] = useActionState(resetPasswordAction, null);

  if (state?.success) {
    return (
      <>
        <p className="auth-success">Password updated! You can now sign in.</p>
        <p className="auth-switch">
          <Link href="/sign-in" className="auth-link">
            Go to sign in
          </Link>
        </p>
      </>
    );
  }

  if (!token) {
    return <p className="auth-error">Invalid or missing reset link.</p>;
  }

  return (
    <form action={action} className="auth-form">
      {state?.error && <p className="auth-error">{state.error}</p>}
      <input type="hidden" name="token" value={token} />

      <div className="form-group">
        <label className="form-label" htmlFor="password">
          New password
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
        <p className="auth-hint">At least 8 characters</p>
      </div>

      <button type="submit" disabled={pending} className="btn-primary auth-submit">
        {pending ? "Updating…" : "Set new password"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="sign-in-page">
      <div className="sign-in-card">
        <h1 className="sign-in-title">New password</h1>
        <p className="sign-in-subtitle">Choose a new password for your account.</p>
        <Suspense>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
