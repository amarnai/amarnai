"use client";

import { useActionState } from "react";
import Link from "next/link";
import { registerAction } from "@/actions/auth";
import { AuthShell } from "@/components/AuthShell";

export function SignUpForm() {
  const [state, action, pending] = useActionState(registerAction, null);

  return (
    <AuthShell title="Create your account">
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
          <label className="form-label" htmlFor="password">
            Password
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
          {pending ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="auth-switch">
        Already have an account?{" "}
        <Link href="/sign-in" className="auth-link">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
