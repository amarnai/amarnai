import { useEffect, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type {
  ApiClient,
  GmailConnection,
  GmailSyncSettingsResponse,
  MailProvider,
} from "@amarnai/api-client";
import {
  WorkspaceNameSection,
  WorkspaceLanguageSection,
  GmailSyncSettingsSection,
  LabelWritebackSection,
} from "@amarnai/ui/settings";
import { useSession } from "../auth/session";
import { openWebApp } from "./openWebApp";

type Props = {
  api: ApiClient;
  workspaceId: string;
  onClose: () => void;
};

/**
 * The settings a user reaches for while triaging: what the workspace is called,
 * what language it speaks, which mail gets imported, and whether folders are
 * mirrored into the mailbox.
 *
 * Everything heavier or more destructive stays on the web, reachable through the
 * link at the bottom: billing, team members, the sender blacklist, connecting
 * and disconnecting a mailbox, and resetting or deleting the workspace. Those
 * either need room to show consequences or are rare enough that the extra step
 * is the right amount of friction.
 */
export function SettingsOverlay({ api, workspaceId, onClose }: Props) {
  const { _ } = useLingui();
  const { workspaces, refreshWorkspaces } = useSession();
  const workspace = workspaces.find((w) => w.id === workspaceId) ?? null;

  const [settings, setSettings] = useState<GmailSyncSettingsResponse | null>(null);
  const [connection, setConnection] = useState<GmailConnection | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, c] = await Promise.all([
          api.gmailSyncSettings(workspaceId),
          api.gmailConnection(workspaceId).catch(() => null),
        ]);
        if (cancelled) return;
        setSettings(s);
        setConnection(c);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, workspaceId]);

  const provider: MailProvider = connection?.provider ?? "GMAIL";
  const mailActive = connection?.status === "ACTIVE";

  return (
    <div className="ps-overlay">
      <div className="ax-editor">
        <div className="ax-editor-head">
          <button type="button" className="ax-back" onClick={onClose} aria-label={_(msg`Back`)}>
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path
                d="M9 11L5 7l4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <h2 className="ax-editor-title">
            <Trans>Settings</Trans>
          </h2>
        </div>

        <div className="ax-settings-body">
          {failed && (
            <p className="st-error" role="alert">
              <Trans>Could not load your settings. Please try again.</Trans>
            </p>
          )}
          {!settings && !failed && (
            <div className="ax-center">
              <span className="ax-spinner" aria-label={_(msg`Loading`)} />
            </div>
          )}

          {settings && workspace && (
            <>
              <WorkspaceNameSection
                api={api}
                workspaceId={workspaceId}
                currentName={workspace.name}
                onSaved={() => void refreshWorkspaces()}
              />
              <WorkspaceLanguageSection
                api={api}
                workspaceId={workspaceId}
                currentLocale={workspace.locale}
                // The session derives the active locale from the workspace list,
                // so re-pulling it re-activates the Lingui provider.
                onChanged={() => refreshWorkspaces()}
              />

              {/* Sync and writeback describe a mailbox, so they are meaningless
                  without an active connection. Connecting one is a web flow. */}
              {mailActive && (
                <section className="st-section">
                  <h2 className="st-title">
                    <Trans>Mail</Trans>
                  </h2>
                  <GmailSyncSettingsSection
                    api={api}
                    workspaceId={workspaceId}
                    provider={provider}
                    initialSettings={settings}
                  />
                  {settings.writebackAvailable && (
                    <LabelWritebackSection
                      api={api}
                      workspaceId={workspaceId}
                      provider={provider}
                      initialEnabled={settings.labelWritebackEnabled}
                      hasWriteScope={settings.hasWritebackScope}
                      // The panel has no incremental-consent route of its own, so
                      // the grant is done on the web and the panel picks up the
                      // result on its next load.
                      onRequestWriteScope={() => void openWebApp(api, "/settings")}
                    />
                  )}
                </section>
              )}

              <button
                type="button"
                className="st-btn"
                onClick={() => void openWebApp(api, "/settings")}
              >
                <Trans>More settings on the web</Trans>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
