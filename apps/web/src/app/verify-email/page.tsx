"use client";

import { useActionState } from "react";
import { resendVerificationAction, signOutAction } from "@/actions/auth";

export default function VerifyEmailPage() {
  const [state, action, pending] = useActionState(resendVerificationAction, null);

  return (
    <div className="sign-in-page">
      <div className="sign-in-card">
        <h1 className="sign-in-title">Check your inbox</h1>
        <p className="sign-in-subtitle">
          We sent a verification link to your email address. Click it to activate your account.
        </p>

        {state?.error && <p className="auth-error">{state.error}</p>}
        {state?.success && <p className="auth-success">Verification email sent!</p>}

        <form action={action} className="auth-form">
          <button type="submit" disabled={pending} className="btn-primary auth-submit">
            {pending ? "Sending…" : "Resend verification email"}
          </button>
        </form>

        <form action={signOutAction} className="auth-form" style={{ marginTop: 12 }}>
          <button type="submit" className="btn-ghost auth-submit">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
