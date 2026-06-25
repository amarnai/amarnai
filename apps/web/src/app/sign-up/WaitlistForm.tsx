"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { joinWaitlistAction } from "@/actions/waitlist";
import { AuthShell } from "@/components/AuthShell";

export function WaitlistForm({ formToken }: { formToken: string }) {
  const { _ } = useLingui();
  const [state, action, pending] = useActionState(joinWaitlistAction, null);

  if (state?.email) {
    return (
      <AuthShell title={_( msg`You're on the list!`)} subtitle={_( msg`Amarnai is in closed beta`)}>
        <p className="auth-success">
          <Trans>
            We&apos;ll send your invite to <strong>{state.email}</strong>.
          </Trans>
        </p>
        <p className="auth-hint">
          <Trans>
            Access is granted to that exact Google account, so if it isn&apos;t the one whose Gmail
            you want Amarnai to organize, just submit the right address.
          </Trans>
        </p>
        <p className="auth-switch">
          <Trans>
            Already invited?{" "}
            <Link href="/sign-in" className="auth-link">
              Sign in
            </Link>
          </Trans>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={_( msg`Join the waitlist`)} subtitle={_( msg`Amarnai is in closed beta`)}>
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
            <Trans>Google account email</Trans>
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
            <Trans>
              Important: enter the email of the Google account you&apos;ll sign in with, the one
              whose Gmail you want Amarnai to organize. Usually that&apos;s your @gmail.com address;
              Google Workspace addresses work too. Your invite gives access to that account only.
            </Trans>
          </p>
        </div>

        <button type="submit" disabled={pending} className="btn-primary auth-submit">
          {pending ? _( msg`Joining…`) : _( msg`Join waitlist`)}
        </button>
      </form>

      <p className="auth-switch">
        <Trans>
          Already invited?{" "}
          <Link href="/sign-in" className="auth-link">
            Sign in
          </Link>
        </Trans>
      </p>
    </AuthShell>
  );
}
