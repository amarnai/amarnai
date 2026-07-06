import { useState, type FormEvent } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { GoogleGIcon } from "@amarnai/ui";
import { useSession } from "./session";
import { GoogleAuthCancelledError } from "./googleAuth";
import { WEB_APP_URL } from "../config";
import { ensureHostPermissions } from "../platform/permissions";

// Firefox treats host permissions as user-grantable and may not have them yet;
// Chrome grants them at install, so this resolves true without a prompt there.
const NEEDS_PERMISSIONS = msg`Amarnai needs access to its server and Gmail to work. Please allow access and try again.`;

export function SignInScreen() {
  const { _ } = useLingui();
  const { signIn, signInWithGoogle } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
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
      setBusy(false);
    }
  }

  async function onGoogle() {
    if (busy) return;
    setError(null);
    setBusy(true);
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
      setBusy(false);
    }
  }

  return (
    <div className="ax-auth">
      <div className="ax-auth-brand">
        <img src="/icons/icon48.png" width={32} height={32} alt="" />
        <span className="ax-auth-title">Amarnai</span>
      </div>
      <p className="ax-auth-tagline">
        <Trans>See how your inbox is sorted, right next to Gmail.</Trans>
      </p>

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

        {error && <p className="ax-auth-error" role="alert">{error}</p>}

        <button type="submit" className="ax-btn ax-btn-primary" disabled={busy}>
          <Trans>Sign in</Trans>
        </button>
      </form>

      <div className="ax-auth-divider"><span><Trans>or</Trans></span></div>

      <button type="button" className="ax-btn ax-btn-google" onClick={onGoogle} disabled={busy}>
        <GoogleGIcon />
        <Trans>Sign in with Google</Trans>
      </button>

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
