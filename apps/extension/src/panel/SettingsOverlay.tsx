import { useCallback, useEffect, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type {
  ApiClient,
  GmailConnection,
  GmailSyncSettingsResponse,
  MailProvider,
  SyncStatus,
} from "@amarnai/api-client";
import {
  PlanSection,
  WorkspaceNameSection,
  WorkspaceLanguageSection,
  GmailSyncSettingsSection,
  LabelWritebackSection,
} from "@amarnai/ui/settings";
import { useSession } from "../auth/session";
import { openWebApp, useWebAppLink } from "./openWebApp";

type Props = {
  api: ApiClient;
  workspaceId: string;
  /** Open the in-panel plan picker (owned by EmailsPanel, like the other overlays). */
  onUpgrade: () => void;
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
 * is the right amount of friction. Collaborators get a dedicated row anyway:
 * managing them still happens on the web, but the feature is worth advertising
 * where owners actually spend their time.
 */
export function SettingsOverlay({ api, workspaceId, onUpgrade, onClose }: Props) {
  const { _ } = useLingui();
  const { workspaces, userId, refreshWorkspaces } = useSession();
  const webAppLink = useWebAppLink();
  const workspace = workspaces.find((w) => w.id === workspaceId) ?? null;

  // Everything below the plan is owner-only server-side: PATCH /workspaces/:id
  // and checkout both reject a member. Mirror the web settings page and hide
  // those controls rather than letting them fail on submit.
  //
  // Read from the membership role, not `workspace.owner`: those are separate
  // columns (Workspace.ownerUserId vs WorkspaceMember.role) and every server
  // check behind these controls consults the role. Gating on the other one
  // renders controls the server then refuses.
  const isOwner =
    workspace?.members.some((m) => m.user.id === userId && m.role === "OWNER") ?? false;

  const [settings, setSettings] = useState<GmailSyncSettingsResponse | null>(null);
  const [connection, setConnection] = useState<GmailConnection | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [s, c, st] = await Promise.all([
        api.gmailSyncSettings(workspaceId),
        api.gmailConnection(workspaceId).catch(() => null),
        api.syncStatus(workspaceId).catch(() => null),
      ]);
      setSettings(s);
      setConnection(c);
      setSyncStatus(st);
    } catch {
      setFailed(true);
    }
  }, [api, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Permission grants happen on the web, in another tab. Re-read on the way
  // back so the writeback switch reflects the new scope instead of sitting at
  // OFF until the panel is closed and reopened.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

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
              <PlanSection
                plan={workspace.plan}
                billingEnabled={syncStatus?.billingEnabled ?? false}
                isOwner={isOwner}
                onUpgrade={onUpgrade}
              />

              {isOwner && (
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
                    // The session derives the active locale from the workspace
                    // list, so re-pulling it re-activates the Lingui provider.
                    onChanged={() => refreshWorkspaces()}
                  />
                </>
              )}

              {/* Sync and writeback describe a mailbox, so they are meaningless
                  without an active connection. Connecting one is a web flow. */}
              {isOwner && mailActive && (
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
                      // The section seeds its switch from these props once, so a
                      // grant completed in another tab only shows up if it
                      // remounts. The scope is what the grant changes.
                      key={String(settings.hasWritebackScope)}
                      api={api}
                      workspaceId={workspaceId}
                      provider={provider}
                      initialEnabled={settings.labelWritebackEnabled}
                      hasWriteScope={settings.hasWritebackScope}
                      // The panel has no incremental-consent route of its own, so
                      // the grant is done on the web. `?writeback=connect` starts
                      // it on arrival rather than dropping the user on the
                      // settings page to click the same toggle again.
                      onRequestWriteScope={() =>
                        void openWebApp(api, "/settings?writeback=connect")
                      }
                    />
                  )}
                </section>
              )}

              {/* Managing members lives on the web (the invite itself is a web
                  flow); this row exists so owners triaging here learn the
                  workspace can be shared at all. Owner-only because inviting
                  is, and members already know the team exists. */}
              {isOwner && (
                <section className="st-section">
                  <h2 className="st-title">
                    <Trans>Collaborators</Trans>
                  </h2>
                  <p className="st-hint">
                    <Trans>
                      Invite teammates to this workspace to triage the inbox together.
                    </Trans>
                  </p>
                  <div className="st-actions">
                    <a className="st-btn" {...webAppLink("/settings#team-members")}>
                      <Trans>Invite collaborators</Trans>
                    </a>
                  </div>
                </section>
              )}

              <button
                type="button"
                className="st-btn"
                onClick={() => void openWebApp(api, "/settings")}
              >
                <Trans>Open all settings in a new tab</Trans>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
