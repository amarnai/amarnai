"use client";

import { useState, useTransition } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { disconnectGmailAction, type DisconnectOutcome } from "@/actions/gmail";
import type { GmailConnection, MailProvider, SyncStatus, GmailSyncSettings } from "@/lib/api";
import { GmailSyncSettingsSection } from "./GmailSyncSettingsSection";
import { GoogleGIcon, OutlookIcon } from "@amarnai/ui";

const DEFAULT_SYNC_SETTINGS: GmailSyncSettings = {
  includeSpam: false,
  includePromotions: false,
  sortingPaused: false,
  routeBulkToOther: true,
  blacklistedSenderEmails: [],
};

type Props = {
  workspaceId: string;
  connection: GmailConnection;
  syncStatus: SyncStatus;
  syncSettings: GmailSyncSettings | null;
  connectError: string | null;
  // Which provider a failed connect attempt was for (drives the error copy).
  connectProvider: MailProvider;
  // Whether the Outlook provider is configured, so the empty state can offer it.
  outlookEnabled: boolean;
  // Whether the workspace holds retained synced email that connecting a
  // different inbox would erase. Drives the inbox-switch warning.
  hasSyncedData: boolean;
};

const GOOGLE_PERMISSIONS_URL = "https://myaccount.google.com/permissions";
const MICROSOFT_PERMISSIONS_URL = "https://account.microsoft.com/consent";

function AccountPermissionsLink({ provider }: { provider: MailProvider }) {
  if (provider === "OUTLOOK") {
    return (
      <a href={MICROSOFT_PERMISSIONS_URL} target="_blank" rel="noreferrer">
        <Trans>Microsoft account permissions</Trans>
      </a>
    );
  }
  return (
    <a href={GOOGLE_PERMISSIONS_URL} target="_blank" rel="noreferrer">
      <Trans>Google Account permissions</Trans>
    </a>
  );
}

// Gmail connect-error copy (unchanged keys so existing translations are kept).
const GMAIL_ERROR_MESSAGES: Record<string, MessageDescriptor> = {
  access_denied:
    msg`Access was denied. Grant read-only Gmail access to connect.`,
  invalid_callback:
    msg`The authorization callback was incomplete. Please try again.`,
  invalid_state:
    msg`The authorization request expired or was tampered with. Please try again.`,
  unauthorized:
    msg`You do not have permission to connect a Gmail inbox to this workspace.`,
  token_exchange:
    msg`Google could not complete the authorization. The link may have expired: please try again. If the problem persists, check that the Gmail callback URL is registered in Google Cloud Console.`,
  insufficient_scope:
    msg`Gmail read-only access was not granted. Please try again and approve the requested permission.`,
  gmail_profile_fetch:
    msg`Could not access your Gmail inbox. Make sure the Gmail API is enabled and the gmail.readonly scope is added to the OAuth consent screen in Google Cloud Console.`,
  google_account_info:
    msg`Could not verify your Google account. Please try again.`,
  db_upsert:
    msg`The connection could not be saved due to a server error. Please try again.`,
};

// Outlook connect-error copy (Microsoft-specific wording).
const OUTLOOK_ERROR_MESSAGES: Record<string, MessageDescriptor> = {
  access_denied:
    msg`Access was denied. Grant read-only Outlook (Mail.Read) access to connect.`,
  invalid_callback:
    msg`The authorization callback was incomplete. Please try again.`,
  invalid_state:
    msg`The authorization request expired or was tampered with. Please try again.`,
  unauthorized:
    msg`You do not have permission to connect an Outlook inbox to this workspace.`,
  token_exchange:
    msg`Microsoft could not complete the authorization. The link may have expired: please try again. If the problem persists, check that the redirect URI is registered on the app registration.`,
  insufficient_scope:
    msg`Outlook read-only access (Mail.Read) was not granted. Please try again and approve the requested permission.`,
  profile_fetch:
    msg`Could not access your Outlook inbox. Please try again.`,
  db_upsert:
    msg`The connection could not be saved due to a server error. Please try again.`,
};

function formatDate(iso: string | null, never: string): string {
  if (!iso) return never;
  return new Date(iso).toLocaleString();
}

const SYNC_BADGE: Record<
  "IDLE" | "SYNCING" | "ERROR",
  { label: MessageDescriptor; className: string }
> = {
  IDLE:    { label: msg`Up to date`,  className: "sync-badge sync-badge-idle" },
  SYNCING: { label: msg`Syncing…`,    className: "sync-badge sync-badge-syncing" },
  ERROR:   { label: msg`Sync error`,  className: "sync-badge sync-badge-error" },
};

export function GmailConnectionSection({
  workspaceId,
  connection,
  syncStatus,
  syncSettings,
  connectError,
  connectProvider,
  outlookEnabled,
  hasSyncedData,
}: Props) {
  const { _ } = useLingui();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [eraseData, setEraseData] = useState(false);
  const [outcome, setOutcome] = useState<DisconnectOutcome | null>(null);
  // Which provider path the user is confirming an inbox switch to, if any.
  const [switchingTo, setSwitchingTo] = useState<"gmail" | "outlook" | null>(null);

  function handleDisconnect() {
    startTransition(async () => {
      const result = await disconnectGmailAction(workspaceId, { eraseData });
      setOutcome(result);
      setConfirming(false);
      setEraseData(false);
    });
  }

  // The connected provider, or the one a failed connect attempt targeted.
  const provider: MailProvider = connection?.provider ?? connectProvider;
  const isOutlook = provider === "OUTLOOK";
  const providerName = isOutlook ? "Outlook" : "Gmail";
  const connectPath = isOutlook ? "outlook" : "gmail";
  const ProviderIcon = isOutlook ? OutlookIcon : GoogleGIcon;
  // Primary connect/reconnect action carries the provider's brand color.
  const primaryBtnClass = isOutlook ? "btn-outlook" : "btn-primary";

  // Providers the user could switch TO from the currently connected one. Gmail
  // is always available; Outlook only when configured. Switching to any of
  // these connects a different inbox, which erases retained data.
  const otherProviders = [
    ...(provider !== "GMAIL"
      ? [{ path: "gmail" as const, name: "Gmail", Icon: GoogleGIcon, btnClass: "btn-outline-clay" }]
      : []),
    ...(provider !== "OUTLOOK" && outlookEnabled
      ? [{ path: "outlook" as const, name: "Outlook", Icon: OutlookIcon, btnClass: "btn-outline-outlook" }]
      : []),
  ];

  const errorMap = connectProvider === "OUTLOOK" ? OUTLOOK_ERROR_MESSAGES : GMAIL_ERROR_MESSAGES;
  const errorMessage = connectError
    ? (errorMap[connectError]
        ? _(errorMap[connectError])
        : _(msg`Connection failed. Please try again.`))
    : null;

  // Address of the inbox whose synced data is retained (named local so the
  // Lingui placeholder is stable across the warnings that reference it).
  const retainedAddress = connection?.gmailAddress ?? "";

  const badge = syncStatus ? SYNC_BADGE[syncStatus.status] : null;
  const alsoConnectedIn = connection?.alsoConnectedIn ?? [];
  // sharedMailbox is cross-tenant (drives whether disconnecting revokes the
  // grant); alsoConnectedIn only lists workspaces this user can see.
  const sharedMailbox = connection?.sharedMailbox ?? false;
  const isShared = alsoConnectedIn.length > 0;
  const sharedNames = alsoConnectedIn.map((w) => w.name).join(", ");

  const disconnectWarning = !sharedMailbox ? (
    <Trans>
      Stops syncing and revokes Amarnai&apos;s access to this mailbox. Synced
      email data is kept so you can reconnect later.
    </Trans>
  ) : isShared ? (
    <Trans>
      Disconnects this workspace. Amarnai keeps access because this mailbox is
      still connected in {sharedNames}.
    </Trans>
  ) : (
    <Trans>
      Disconnects this workspace. Amarnai keeps access because this mailbox is
      also connected elsewhere in Amarnai. To fully revoke access, remove
      Amarnai from your <AccountPermissionsLink provider={provider} />.
    </Trans>
  );

  const erasedNote = outcome?.erased ? _(msg`Synced email data was erased.`) : null;

  return (
    <section className="settings-section">
      <h2><Trans>{providerName} Inbox</Trans></h2>

      {errorMessage && (
        <div className="alert alert-error">{errorMessage}</div>
      )}

      {connection?.status === "ACTIVE" ? (
        <>
          <div className="gmail-connection-status">
            <div className="gmail-address">{connection.gmailAddress}</div>
            <div className="gmail-meta" suppressHydrationWarning>
              <Trans>Last verified: {formatDate(connection.lastVerifiedAt, _(msg`Never`))}</Trans>
            </div>

            {isShared && (
              <div className="alert alert-info">
                <Trans>This inbox is also connected in {sharedNames}. Each workspace syncs and classifies it separately, which uses separate AI quota.</Trans>
              </div>
            )}

            {syncStatus !== null ? (
              <div className="sync-status-row">
                <span className="sync-status-label"><Trans>Inbox sync</Trans></span>
                {badge && <span className={badge.className}>{_(badge.label)}</span>}
                <span className="sync-status-time" suppressHydrationWarning>
                  {syncStatus.lastSyncedAt
                    ? _(msg`Last synced ${formatDate(syncStatus.lastSyncedAt, _(msg`Never`))}`)
                    : _(msg`Not yet synced`)}
                </span>
                {syncStatus.status === "ERROR" && syncStatus.errorMessage && (
                  <div className="sync-error-message">{syncStatus.errorMessage}</div>
                )}
              </div>
            ) : (
              <div className="sync-status-row">
                <span className="sync-status-label"><Trans>Inbox sync</Trans></span>
                <span className="sync-status-time"><Trans>Waiting for first sync…</Trans></span>
              </div>
            )}

            {!confirming ? (
              <button
                className="btn-danger"
                onClick={() => setConfirming(true)}
                disabled={isPending}
                type="button"
              >
                <Trans>Disconnect {providerName}</Trans>
              </button>
            ) : (
              <div className="account-delete-confirm">
                <p className="account-danger-warning">{disconnectWarning}</p>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={eraseData}
                    onChange={(e) => setEraseData(e.target.checked)}
                    disabled={isPending}
                  />
                  <Trans>Also erase synced email data</Trans>
                </label>
                <div className="account-delete-actions">
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={handleDisconnect}
                    disabled={isPending}
                  >
                    {isPending ? <Trans>Disconnecting…</Trans> : <Trans>Yes, disconnect</Trans>}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => { setConfirming(false); setEraseData(false); }}
                    disabled={isPending}
                  >
                    <Trans>Cancel</Trans>
                  </button>
                </div>
              </div>
            )}
          </div>

          <GmailSyncSettingsSection
            workspaceId={workspaceId}
            provider={provider}
            initialSettings={syncSettings ?? DEFAULT_SYNC_SETTINGS}
          />
        </>
      ) : connection?.status === "DISCONNECTED" ? (
        <div className="gmail-connection-status">
          <div className="gmail-address">{connection.gmailAddress}</div>
          {outcome ? (
            // Reports what the disconnect actually did, not what was predicted.
            outcome.sharedMailbox ? (
              <div className="alert alert-info">
                <Trans>
                  Disconnected from this workspace. {erasedNote} Amarnai still has
                  access because this mailbox is connected in another workspace.
                  To fully revoke access, remove Amarnai from your{" "}
                  <AccountPermissionsLink provider={provider} />.
                </Trans>
              </div>
            ) : outcome.revoked ? (
              <div className="alert alert-success">
                <Trans>
                  Disconnected. Amarnai&apos;s access to this mailbox was revoked.
                  {erasedNote}
                </Trans>
              </div>
            ) : (
              <div className="alert alert-info">
                <Trans>
                  Disconnected. {erasedNote} To fully revoke Amarnai&apos;s access,
                  remove it from your <AccountPermissionsLink provider={provider} />.
                </Trans>
              </div>
            )
          ) : (
            <div className="alert alert-error">
              <Trans>Disconnected. Amarnai is no longer syncing this inbox.</Trans>
            </div>
          )}
          {hasSyncedData && (
            <p className="gmail-meta">
              <Trans>
                Your sorted email from {retainedAddress} is saved.
                Reconnecting the same inbox restores it; connecting a different
                inbox permanently removes it. Folders and settings are kept
                either way.
              </Trans>
            </p>
          )}
          <a
            href={`/api/${connectPath}/connect?workspaceId=${workspaceId}`}
            className={primaryBtnClass}
          >
            <ProviderIcon variant="mono" size={16} />
            <Trans>Reconnect {providerName}</Trans>
          </a>

          {otherProviders.length > 0 && (
            <div className="gmail-connection-switch">
              <p className="gmail-meta"><Trans>Or connect a different inbox:</Trans></p>
              {otherProviders.map(({ path, name, Icon, btnClass }) =>
                switchingTo === path ? (
                  <div key={path} className="account-delete-confirm">
                    <p className="account-danger-warning">
                      {hasSyncedData ? (
                        <Trans>
                          Connecting {name} will permanently remove the sorted
                          email saved from {retainedAddress}. Your folders
                          and settings are kept.
                        </Trans>
                      ) : (
                        <Trans>Connect {name} to this workspace?</Trans>
                      )}
                    </p>
                    <div className="account-delete-actions">
                      <a
                        href={`/api/${path}/connect?workspaceId=${workspaceId}`}
                        className="btn-danger"
                      >
                        <Trans>Continue to {name}</Trans>
                      </a>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => setSwitchingTo(null)}
                      >
                        <Trans>Cancel</Trans>
                      </button>
                    </div>
                  </div>
                ) : hasSyncedData ? (
                  <button
                    key={path}
                    type="button"
                    className={btnClass}
                    onClick={() => setSwitchingTo(path)}
                  >
                    <Icon variant="mono" size={16} />
                    <Trans>Connect {name}</Trans>
                  </button>
                ) : (
                  <a
                    key={path}
                    href={`/api/${path}/connect?workspaceId=${workspaceId}`}
                    className={btnClass}
                  >
                    <Icon variant="mono" size={16} />
                    <Trans>Connect {name}</Trans>
                  </a>
                )
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="gmail-connection-empty">
          <p><Trans>No inbox connected to this workspace.</Trans></p>
          <a
            href={`/api/gmail/connect?workspaceId=${workspaceId}`}
            className="btn-primary"
          >
            <GoogleGIcon variant="mono" size={16} />
            <Trans>Connect Gmail</Trans>
          </a>
          {outlookEnabled && (
            <a
              href={`/api/outlook/connect?workspaceId=${workspaceId}`}
              className="btn-outlook"
            >
              <OutlookIcon variant="mono" size={16} />
              <Trans>Connect Outlook</Trans>
            </a>
          )}
        </div>
      )}
    </section>
  );
}
