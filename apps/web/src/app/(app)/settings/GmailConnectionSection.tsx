"use client";

import { useTransition } from "react";
import { disconnectGmailAction } from "@/actions/gmail";
import type { GmailConnection } from "@/lib/api";

type Props = {
  workspaceId: string;
  connection: GmailConnection;
  connectError: string | null;
  connectSuccess: boolean;
};

const ERROR_MESSAGES: Record<string, string> = {
  access_denied:
    "Access was denied. Grant read-only Gmail access to connect.",
  invalid_callback:
    "The authorization callback was incomplete. Please try again.",
  invalid_state:
    "The authorization request expired or was tampered with. Please try again.",
  unauthorized:
    "You do not have permission to connect a Gmail inbox to this workspace.",
  token_exchange:
    "Google could not complete the authorization. The link may have expired — please try again. If the problem persists, check that the Gmail callback URL is registered in Google Cloud Console.",
  insufficient_scope:
    "Gmail read-only access was not granted. Please try again and approve the requested permission.",
  gmail_profile_fetch:
    "Could not access your Gmail inbox. Make sure the Gmail API is enabled and the gmail.readonly scope is added to the OAuth consent screen in Google Cloud Console.",
  google_account_info:
    "Could not verify your Google account. Please try again.",
  db_upsert:
    "The connection could not be saved due to a server error. Please try again.",
};

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString();
}

export function GmailConnectionSection({
  workspaceId,
  connection,
  connectError,
  connectSuccess,
}: Props) {
  const [isPending, startTransition] = useTransition();

  function handleDisconnect() {
    startTransition(async () => {
      await disconnectGmailAction(workspaceId);
    });
  }

  const errorMessage = connectError
    ? (ERROR_MESSAGES[connectError] ?? "Connection failed. Please try again.")
    : null;

  return (
    <section className="settings-section">
      <h2>Gmail Inbox</h2>

      {connectSuccess && (
        <div className="alert alert-success">Gmail inbox connected successfully.</div>
      )}
      {errorMessage && (
        <div className="alert alert-error">{errorMessage}</div>
      )}

      {connection ? (
        <div className="gmail-connection-status">
          <div className="gmail-address">{connection.gmailAddress}</div>
          <div className="gmail-meta">
            Last verified: {formatDate(connection.lastVerifiedAt)}
          </div>
          <button
            className="btn-danger"
            onClick={handleDisconnect}
            disabled={isPending}
            type="button"
          >
            {isPending ? "Disconnecting…" : "Disconnect Gmail"}
          </button>
        </div>
      ) : (
        <div className="gmail-connection-empty">
          <p>No Gmail inbox connected to this workspace.</p>
          <a
            href={`/api/gmail/connect?workspaceId=${workspaceId}`}
            className="btn-primary"
          >
            Connect Gmail
          </a>
        </div>
      )}
    </section>
  );
}
