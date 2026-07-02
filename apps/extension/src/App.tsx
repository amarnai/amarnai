import { Trans } from "@lingui/react/macro";
import { SessionProvider, useSession } from "./auth/session";
import { LinguiProvider } from "./i18n/LinguiProvider";
import { SignInScreen } from "./auth/SignInScreen";
import { TriageGate } from "./panel/TriageGate";
import { GoogleGIcon } from "@amarnai/ui";
import { WEB_APP_URL } from "./config";
import type { SupportedLocale } from "@amarnai/i18n";

function Gate() {
  const { status, workspaceId, userId, client, locale } = useSession();

  // Wrap in the locale provider once the session's locale is known (null before
  // sign-in falls back to the browser locale inside LinguiProvider).
  return (
    <LinguiProvider locale={locale as SupportedLocale | null}>
      {status === "loading" ? (
        <div className="ax-center">
          <span className="ax-spinner" aria-label="Loading" />
        </div>
      ) : status === "signedOut" ? (
        <SignInScreen />
      ) : !workspaceId || !userId ? (
        <NoWorkspace />
      ) : (
        <TriageGate api={client} workspaceId={workspaceId} currentUserId={userId} />
      )}
    </LinguiProvider>
  );
}

// Signed in but no workspace yet: the user has an account but hasn't connected
// Gmail. That flow lives on the web app (OAuth consent), so point them there.
// The sign-out control lets a user who signed into the wrong account get out
// (otherwise this screen is a dead end — there is no workspace picker yet).
function NoWorkspace() {
  const { signOut } = useSession();
  return (
    <div className="ax-center ax-muted ax-noworkspace">
      <p><Trans>Connect your Gmail account to start triaging.</Trans></p>
      <a className="ax-btn ax-btn-primary" href={`${WEB_APP_URL}/emails`} target="_blank" rel="noopener noreferrer">
        <GoogleGIcon variant="mono" size={16} />
        <Trans>Connect Gmail</Trans>
      </a>
      <button type="button" className="ax-linkbtn" onClick={() => void signOut()}>
        <Trans>Sign out</Trans>
      </button>
    </div>
  );
}

export function App() {
  return (
    <SessionProvider>
      <Gate />
    </SessionProvider>
  );
}
