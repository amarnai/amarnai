"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { resendVerificationAction, signOutAction } from "@/actions/auth";
import { AuthShell } from "@/components/AuthShell";

export default function VerifyEmailPage() {
  const { _ } = useLingui();
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
      title={_( msg`Check your inbox`)}
      subtitle={_(
        msg`We sent a verification link to your email address. Click it to activate your account.`,
      )}
    >
      {state?.error && <p className="auth-error">{state.error}</p>}
      {state?.success && <p className="auth-success"><Trans>Verification email sent!</Trans></p>}

      <form action={action} className="auth-form">
        <button type="submit" disabled={pending} className="btn-primary auth-submit">
          {pending ? _( msg`Sending…`) : _( msg`Resend verification email`)}
        </button>
      </form>

      <form action={signOutAction} className="auth-form" style={{ marginTop: 10 }}>
        <button type="submit" className="btn-ghost auth-submit">
          <Trans>Sign out</Trans>
        </button>
      </form>
    </AuthShell>
  );
}
