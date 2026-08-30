import { useEffect, useState, type FormEvent } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { GoogleGIcon, MicrosoftIcon } from "@aziru/ui";
import { useSession } from "./session";
import { GoogleAuthCancelledError } from "./googleAuth";
import { MicrosoftAuthCancelledError } from "./microsoftAuth";
import { MS_CLIENT_ID, WEB_APP_URL } from "../config";
import { ensureHostPermissions } from "../platform/permissions";
import { prefetchWritebackPolicy } from "./writebackPolicy";

// Firefox treats host permissions as user-grantable and may not have them yet;
// Chrome grants them at install, so this resolves true without a prompt there.
const NEEDS_PERMISSIONS = msg`Amarnai needs access to its server and your inbox to work. Please allow access and try again.`;

// Which sign-in flow is in flight, so all controls disable together while only
// the clicked one owns the outcome. Mirrors ConnectMailCta's `pending`.
type Pending = "google" | "microsoft" | "email" | null;

export function SignInScreen() {
  const { _ } = useLingui();
  const { signIn, signInWithGoogle, signInWithMicrosoft } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const busy = pending !== null;

  // Microsoft sign-in is only offered when the extension build carries a
  // Microsoft client id; otherwise the OAuth flow cannot run. Mirrors the web app
  // gating its Microsoft button on isOutlookConfigured().
  const microsoftEnabled = MS_CLIENT_ID.length > 0;

  // Warm the deployment's mail-scope policy so the OAuth flows do not wait on a
  // request to resolve it. Fire-and-forget: a failure means read-only scopes, and
  // the flows work either way.
  useEffect(() => {
    prefetchWritebackPolicy();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setPending("email");
    try {
      // Must be the first await — Firefox drops the user-gesture context otherwise.
      if (!(await ensureHostPermissions())) {
        setError(_(NEEDS_PERMISSIONS));
        return;
      }
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : _(msg`Sign-in failed. Please try again.`));
    } finally {
      setPending(null);
    }
  }

  async function onGoogle() {
    if (busy) return;
    setError(null);
    setPending("google");
    try {
      // Must be the first await — Firefox drops the user-gesture context otherwise.
      if (!(await ensureHostPermissions())) {
        setError(_(NEEDS_PERMISSIONS));
        return;
      }
      await signInWithGoogle();
    } catch (err) {
      // A dismissed OAuth window is not an error worth showing.
      if (!(err instanceof GoogleAuthCancelledError)) {
        setError(err instanceof Error ? err.message : _(msg`Google sign-in failed. Please try again.`));
      }
    } finally {
      setPending(null);
    }
  }

  async function onMicrosoft() {
    if (busy) return;
    setError(null);
    setPending("microsoft");
    try {
      // Must be the first await — Firefox drops the user-gesture context otherwise.
      if (!(await ensureHostPermissions())) {
        setError(_(NEEDS_PERMISSIONS));
        return;
      }
      await signInWithMicrosoft();
    } catch (err) {
      // A dismissed OAuth window is not an error worth showing.
      if (!(err instanceof MicrosoftAuthCancelledError)) {
        setError(
          err instanceof Error ? err.message : _(msg`Microsoft sign-in failed. Please try again.`),
        );
      }
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="ax-auth">
      <div className="ax-auth-brand">
        <img src="/icons/icon48.png" width={32} height={32} alt="" />
        <span className="ax-auth-title">Amarnai</span>
      </div>
      <p className="ax-auth-tagline">
        <Trans>See how your inbox is sorted, right next to your email.</Trans>
      </p>

      {/* Providers first: they are the only paths that create an account, connect
          an inbox and provision a workspace in one grant, so they are what a user
          arriving straight from the store needs. Email sign-in is for people who
          already registered on the web. */}
      <button type="button" className="ax-btn ax-btn-google" onClick={onGoogle} disabled={busy}>
        <GoogleGIcon />
        <Trans>Continue with Google</Trans>
      </button>

      {microsoftEnabled && (
        <button
          type="button"
          className="ax-btn ax-btn-microsoft"
          onClick={onMicrosoft}
          disabled={busy}
        >
          <MicrosoftIcon />
          <Trans>Continue with Microsoft</Trans>
        </button>
      )}

      {error && <p className="ax-auth-error" role="alert">{error}</p>}

      <div className="ax-auth-divider"><span><Trans>or</Trans></span></div>

      <form className="ax-auth-form" onSubmit={onSubmit}>
        <label className="ax-field">
          <span><Trans>Email</Trans></span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="ax-field">
          <span><Trans>Password</Trans></span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        <button type="submit" className="ax-btn ax-btn-primary" disabled={busy}>
          <Trans>Sign in</Trans>
        </button>
      </form>

      <p className="ax-auth-footer">
        <Trans>
          New to Amarnai?{" "}
          <a href={`${WEB_APP_URL}/sign-up`} target="_blank" rel="noopener noreferrer">
            Create an account
          </a>
        </Trans>
      </p>
    </div>
  );
}
