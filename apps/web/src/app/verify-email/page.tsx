"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { resendVerificationAction, signOutAction } from "@/actions/auth";
import { AuthShell } from "@/components/AuthShell";

export default function VerifyEmailPage() {
  const router = useRouter();
  const [state, action, pending] = useActionState(resendVerificationAction, null);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [router]);

  return (
    <AuthShell
      title="Check your inbox"
      subtitle="We sent a verification link to your email address. Click it to activate your account."
    >
      {state?.error && <p className="auth-error">{state.error}</p>}
      {state?.success && <p className="auth-success">Verification email sent!</p>}

      <form action={action} className="auth-form">
        <button type="submit" disabled={pending} className="btn-primary auth-submit">
          {pending ? "Sending…" : "Resend verification email"}
        </button>
      </form>

      <form action={signOutAction} className="auth-form" style={{ marginTop: 10 }}>
        <button type="submit" className="btn-ghost auth-submit">
          Sign out
        </button>
      </form>
    </AuthShell>
  );
}
