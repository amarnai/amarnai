import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { useSession } from "../auth/session";
import { GoogleAuthCancelledError } from "../auth/googleAuth";

// Shown in place of the triage panel when the workspace's Gmail connection is
// DISCONNECTED (revoked or token expired). Mirrors the web ConnectGmailCta: the
// connection lives server-side and is shared with the web app, so reconnecting
// here reactivates it everywhere. Reconnects THIS workspace (not the default one)
// via the session's reconnectGmail. onReconnected reloads the triage seed.
export function ReconnectGmailCta({
  workspaceId,
  onReconnected,
}: {
  workspaceId: string;
  onReconnected: () => void;
}) {
  const { _ } = useLingui();
  const { reconnectGmail } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onReconnect() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await reconnectGmail(workspaceId);
      onReconnected();
    } catch (err) {
      // A dismissed OAuth window is not an error worth showing.
      if (!(err instanceof GoogleAuthCancelledError)) {
        setError(
          err instanceof Error ? err.message : _(msg`Reconnect failed. Please try again.`),
        );
      }
      setBusy(false);
    }
  }

  return (
    <div className="ax-center ax-noworkspace">
      <img src="/icons/icon48.png" width={40} height={40} alt="" />
      <p className="ax-reconnect-title">
        <Trans>Reconnect your Gmail inbox</Trans>
      </p>
      <p className="ax-muted">
        <Trans>
          Amarnai is no longer syncing this inbox. Reconnect your Gmail account to
          resume sorting your email threads. Access stays <strong>read-only</strong>,
          and your inbox stays yours.
        </Trans>
      </p>
      {error && <p className="ax-auth-error" role="alert">{error}</p>}
      <button
        type="button"
        className="ax-btn ax-btn-primary"
        onClick={onReconnect}
        disabled={busy}
      >
        {busy ? <Trans>Reconnecting…</Trans> : <Trans>Reconnect Gmail</Trans>}
      </button>
    </div>
  );
}
