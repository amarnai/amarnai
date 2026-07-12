import { useEffect, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { SessionProvider, useSession } from "./auth/session";
import { LinguiProvider } from "./i18n/LinguiProvider";
import { SignInScreen } from "./auth/SignInScreen";
import { GoogleAuthCancelledError } from "./auth/googleAuth";
import { TriageGate } from "./panel/TriageGate";
import { HostPermissionGate } from "./platform/HostPermissionGate";
import { ensureHostPermissions } from "./platform/permissions";
import { currentBrowser, extensionVersion } from "./platform/ext";
import { GoogleGIcon, ThemeProvider } from "@amarnai/ui";
import type { SupportedLocale } from "@amarnai/i18n";

function Gate() {
  const { status, workspaceId, userId, client, locale } = useSession();

  // Announce the install to the API once signed in, so the web app knows this
  // user has the extension and stops nudging them to install it. Fire-and-forget
  // and idempotent server-side (upsert keyed on the user); a failure is harmless.
  useEffect(() => {
    if (status !== "signedIn") return;
    client
      .registerExtension({ browser: currentBrowser(), version: extensionVersion() })
      .catch((err) => console.error("[amarnai] registerExtension:", err));
  }, [status, client]);

  // Wrap in the locale provider once the session's locale is known (null before
  // sign-in falls back to the browser locale inside LinguiProvider).
  return (
    <LinguiProvider locale={locale as SupportedLocale | null}>
      {status === "loading" ? (
        <div className="ax-center">
          <span className="ax-spinner" aria-label="Loading" />
        </div>
      ) : status === "error" ? (
        <SessionError />
      ) : status === "signedOut" ? (
        <SignInScreen />
      ) : !workspaceId || !userId ? (
        <NoWorkspace />
      ) : (
        <HostPermissionGate>
          <TriageGate api={client} workspaceId={workspaceId} currentUserId={userId} />
        </HostPermissionGate>
      )}
    </LinguiProvider>
  );
}

// Firefox treats host permissions as user-grantable and may not have them yet;
// Chrome grants them at install, so this resolves true without a prompt there.
const NEEDS_PERMISSIONS = msg`Amarnai needs access to its server and your inbox to work. Please allow access and try again.`;

// Signed in but no workspace yet: the user has an account but hasn't connected
// Gmail. Run the Gmail OAuth grant in-panel (same flow as the sign-in screen),
// which provisions the user's default workspace and reconnects the session — the
// consent lands here instead of on the web app, which the extension could not see.
// The sign-out control lets a user who signed into the wrong account get out
// (otherwise this screen is a dead end — there is no workspace picker yet).
function NoWorkspace() {
  const { _ } = useLingui();
  const { signInWithGoogle, signOut } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onConnect() {
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
        setError(err instanceof Error ? err.message : _(msg`Could not connect Gmail. Please try again.`));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ax-center ax-muted ax-noworkspace">
      <p><Trans>Connect your Gmail account to start triaging.</Trans></p>
      {error && <p className="ax-auth-error" role="alert">{error}</p>}
      <button type="button" className="ax-btn ax-btn-primary" onClick={() => void onConnect()} disabled={busy}>
        <GoogleGIcon variant="mono" size={16} />
        <Trans>Connect Gmail</Trans>
      </button>
      <button type="button" className="ax-linkbtn" onClick={() => void signOut()} disabled={busy}>
        <Trans>Sign out</Trans>
      </button>
    </div>
  );
}

// The stored session looks valid (tokens present) but the server was unreachable
// during startup, so identity could not be confirmed. Offer a retry rather than
// signing the user out and destroying a possibly-valid session. retry() flips the
// status back to "loading", so this screen unmounts while the attempt runs.
function SessionError() {
  const { retry } = useSession();
  return (
    <div className="ax-center ax-muted">
      <p><Trans>Couldn't reach Amarnai. Check your connection and try again.</Trans></p>
      <button type="button" className="ax-btn ax-btn-primary" onClick={() => void retry()}>
        <Trans>Retry</Trans>
      </button>
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <SessionProvider>
        <Gate />
      </SessionProvider>
    </ThemeProvider>
  );
}
