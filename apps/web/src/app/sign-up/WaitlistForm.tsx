"use client";

import { useActionState } from "react";
import Link from "next/link";
import { joinWaitlistAction } from "@/actions/waitlist";
import { AuthShell } from "@/components/AuthShell";

export function WaitlistForm({ formToken }: { formToken: string }) {
  const [state, action, pending] = useActionState(joinWaitlistAction, null);

  if (state?.email) {
    return (
      <AuthShell title="You're on the list!" subtitle="Amarnai is in closed beta">
        <p className="auth-success">
          We&apos;ll send your invite to <strong>{state.email}</strong>.
        </p>
        <p className="auth-hint">
          Access is granted to that exact Google account, so if it isn&apos;t the one whose Gmail
          you want Amarnai to organize, just submit the right address.
        </p>
        <p className="auth-switch">
          Already invited?{" "}
          <Link href="/sign-in" className="auth-link">
            Sign in
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Join the waitlist" subtitle="Amarnai is in closed beta">
      <form action={action} className="auth-form">
        {state?.error && <p className="auth-error">{state.error}</p>}

        <input type="hidden" name="ft" value={formToken} />

        {/* Honeypot: hidden from humans, filled by form bots. */}
        <div style={{ display: "none" }} aria-hidden="true">
          <label htmlFor="website">Website</label>
          <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="email">
            Google account email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@gmail.com"
            className="form-input"
          />
          <p className="auth-hint">
            Important: enter the email of the Google account you&apos;ll sign in with, the one
            whose Gmail you want Amarnai to organize. Usually that&apos;s your @gmail.com address;
            Google Workspace addresses work too. Your invite gives access to that account only.
          </p>
        </div>

        <button type="submit" disabled={pending} className="btn-primary auth-submit">
          {pending ? "Joining…" : "Join waitlist"}
        </button>
      </form>

      <p className="auth-switch">
        Already invited?{" "}
        <Link href="/sign-in" className="auth-link">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
