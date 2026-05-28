"use client";

import { useActionState } from "react";
import Link from "next/link";
import { forgotPasswordAction } from "@/actions/auth";

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState(forgotPasswordAction, null);

  return (
    <div className="sign-in-page">
      <div className="sign-in-card">
        <h1 className="sign-in-title">Reset password</h1>
        <p className="sign-in-subtitle">
          Enter your email and we&apos;ll send you a reset link.
        </p>

        {state?.success ? (
          <p className="auth-success">
            If an account exists for that email, a reset link is on its way.
          </p>
        ) : (
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

            <button type="submit" disabled={pending} className="btn-primary auth-submit">
              {pending ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}

        <p className="auth-switch">
          <Link href="/sign-in" className="auth-link">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
