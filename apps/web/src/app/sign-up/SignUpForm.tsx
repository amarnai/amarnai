"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { registerAction } from "@/actions/auth";
import { AuthShell } from "@/components/AuthShell";
import { GoogleButton } from "@/components/GoogleButton";

export function SignUpForm({
  defaultEmail,
  invited = false,
}: {
  defaultEmail?: string | undefined;
  invited?: boolean;
}) {
  const { _ } = useLingui();
  const [state, action, pending] = useActionState(registerAction, null);
  // "try again" returns to the form. We're already on /sign-up, so a route
  // navigation would not remount this component or clear the success state;
  // a local flag does. Resubmitting clears it via the wrapped action below.
  const [retrying, setRetrying] = useState(false);

  const submit = (formData: FormData) => {
    setRetrying(false);
    return action(formData);
  };

  // Success is intentionally identical for every account state (new, already
  // registered, or Google-only): the response must not reveal whether the email
  // is registered. Whatever the case, the right next step arrives by email, so
  // the copy stays generic and never hints at which state applies.
  if (state?.success && !retrying && !pending) {
    return (
      <AuthShell title={_( msg`Check your email`)}>
        <p className="auth-success">
          <Trans>
            We've sent a link to that email address. Follow it to finish signing
            in.
          </Trans>
        </p>
        <p className="auth-switch">
          <Trans>
            Didn't get an email? Check your spam folder, or{" "}
            <button
              type="button"
              className="auth-link"
              onClick={() => setRetrying(true)}
            >
              try again
            </button>
            .
          </Trans>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={_( msg`Create your account`)}>
      {invited && (
        <p className="auth-success">
          <Trans>Create your account to accept your workspace invitation.</Trans>
        </p>
      )}
      <form action={submit} className="auth-form">
        {state?.error && <p className="auth-error">{state.error}</p>}

        <div className="form-group">
          <label className="form-label" htmlFor="email">
            <Trans>Email</Trans>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={defaultEmail}
            className="form-input"
          />
          <p className="auth-hint">
            <Trans>We'll email you a link to set your password and finish signing up.</Trans>
          </p>
        </div>

        <button type="submit" disabled={pending} className="btn-primary auth-submit">
          {pending ? _( msg`Sending…`) : _( msg`Continue with email`)}
        </button>
      </form>

      <div className="auth-divider">
        <span><Trans>or</Trans></span>
      </div>

      <GoogleButton label={_( msg`Sign up with Google`)} />

      <p className="auth-switch">
        <Trans>
          By continuing, you agree to the{" "}
          <Link href="/terms" className="auth-link">
            Terms of Service
          </Link>{" "}
          and acknowledge the{" "}
          <Link href="/privacy" className="auth-link">
            Privacy Policy
          </Link>
          .
        </Trans>
      </p>

      <p className="auth-switch">
        <Trans>
          Already have an account?{" "}
          <Link href="/sign-in" className="auth-link">
            Sign in
          </Link>
        </Trans>
      </p>
    </AuthShell>
  );
}
