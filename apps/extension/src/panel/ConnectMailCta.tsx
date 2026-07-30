import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { MailProvider } from "@amarnai/api-client";
import { GoogleGIcon, OutlookIcon } from "@amarnai/ui";
import { MS_CLIENT_ID } from "../config";
import { useSession } from "../auth/session";
import { GoogleAuthCancelledError } from "../auth/googleAuth";
import { MicrosoftAuthCancelledError } from "../auth/microsoftAuth";

// Shown in place of the triage panel when the workspace's mail connection is not
// ACTIVE. Two modes, mirroring the web emails gate:
//   • No connection record yet (provider === null) → first-time CONNECT. Offers
//     both Gmail and Outlook (Outlook only when configured), like the web app.
//   • A DISCONNECTED record exists (provider set) → RECONNECT that same provider.
// The connection lives server-side and is shared with the web app, so connecting
// here activates it everywhere. Acts on THIS workspace (not the default one).
// onConnected reloads the seed once the connection is ACTIVE.
export function ConnectMailCta({
  workspaceId,
  provider,
  onConnected,
}: {
  workspaceId: string;
  provider: MailProvider | null;
  onConnected: () => void;
}) {
  const { _ } = useLingui();
  const { reconnectGmail, reconnectOutlook, signOut } = useSession();
  // Which provider's OAuth flow is in flight (null when idle), so only the
  // clicked button shows its pending label and both stay disabled meanwhile.
  const [pending, setPending] = useState<MailProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  // No connection row yet: first-time connect, offering both providers.
  const isReconnect = provider !== null;
  const isOutlook = provider === "OUTLOOK";
  // Outlook is only offered when the extension build was given a Microsoft client
  // id; otherwise the Outlook OAuth flow cannot run. Mirrors the web app gating
  // the Outlook button on isOutlookConfigured().
  const outlookEnabled = MS_CLIENT_ID.length > 0;

  async function connect(target: MailProvider) {
    if (pending) return;
    setError(null);
    setPending(target);
    try {
      if (target === "OUTLOOK") await reconnectOutlook(workspaceId);
      else await reconnectGmail(workspaceId);
      onConnected();
    } catch (err) {
      // A dismissed OAuth window is not an error worth showing.
      const cancelled =
        err instanceof GoogleAuthCancelledError || err instanceof MicrosoftAuthCancelledError;
      if (!cancelled) {
        setError(
          err instanceof Error ? err.message : _(msg`Connection failed. Please try again.`),
        );
      }
      setPending(null);
    }
  }

  return (
    <div className="ax-center ax-noworkspace">
      <img src="/icons/icon48.png" width={40} height={40} alt="" />
      <p className="ax-reconnect-title">
        {isReconnect ? (
          isOutlook ? (
            <Trans>Reconnect your Outlook inbox</Trans>
          ) : (
            <Trans>Reconnect your Gmail inbox</Trans>
          )
        ) : (
          <Trans>Connect your inbox</Trans>
        )}
      </p>
      <p className="ax-muted">
        {isReconnect ? (
          isOutlook ? (
            <Trans>
              Amarnai is no longer syncing this inbox. Reconnect your Outlook account
              to resume sorting your email threads. Amarnai{" "}
              <strong>never sends, deletes, or moves your mail</strong>, and your inbox
              stays yours.
            </Trans>
          ) : (
            <Trans>
              Amarnai is no longer syncing this inbox. Reconnect your Gmail account to
              resume sorting your email threads. Amarnai{" "}
              <strong>never sends, deletes, or moves your mail</strong>, and your inbox
              stays yours.
            </Trans>
          )
        ) : (
          <Trans>
            Connect your account to get started. Amarnai{" "}
            <strong>never sends, deletes, or moves your mail</strong>, and the only
            thing it writes is its own sorting labels, which you can switch off. Your
            inbox stays yours.
          </Trans>
        )}
      </p>
      {error && (
        <p className="ax-auth-error" role="alert">
          {error}
        </p>
      )}

      {isReconnect ? (
        <button
          type="button"
          className={`ax-btn ${isOutlook ? "ax-btn-outlook" : "ax-btn-primary"}`}
          onClick={() => connect(provider)}
          disabled={pending !== null}
        >
          {isOutlook ? (
            <OutlookIcon variant="mono" size={16} />
          ) : (
            <GoogleGIcon variant="mono" size={16} />
          )}
          {pending !== null ? (
            <Trans>Reconnecting…</Trans>
          ) : isOutlook ? (
            <Trans>Reconnect Outlook</Trans>
          ) : (
            <Trans>Reconnect Gmail</Trans>
          )}
        </button>
      ) : (
        <>
          <button
            type="button"
            className="ax-btn ax-btn-primary"
            onClick={() => connect("GMAIL")}
            disabled={pending !== null}
          >
            <GoogleGIcon variant="mono" size={16} />
            {pending === "GMAIL" ? <Trans>Connecting…</Trans> : <Trans>Connect Gmail</Trans>}
          </button>
          {outlookEnabled && (
            <button
              type="button"
              className="ax-btn ax-btn-outlook"
              onClick={() => connect("OUTLOOK")}
              disabled={pending !== null}
            >
              <OutlookIcon variant="mono" size={16} />
              {pending === "OUTLOOK" ? (
                <Trans>Connecting…</Trans>
              ) : (
                <Trans>Connect Outlook</Trans>
              )}
            </button>
          )}
        </>
      )}

      <button type="button" className="ax-linkbtn" onClick={() => void signOut()}>
        <Trans>Sign out</Trans>
      </button>
    </div>
  );
}
