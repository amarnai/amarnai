import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, fontSize, fontWeight, radii } from '@amarnai/tokens';
import type { GmailConnection, GmailSyncSettings, SyncStatus } from '@amarnai/api-client';
import { useSession } from '../../../../src/auth/session';
import { AppHeader } from '../../../../src/components/AppHeader';
import { ScreenContainer } from '../../../../src/components/ScreenContainer';
import { SectionTitle } from '../../../../src/components/SectionTitle';
import { SettingsGroup, SettingsRow } from '../../../../src/components/SettingsGroup';
import { UserAvatar } from '../../../../src/components/UserAvatar';
import { WorkspaceMark } from '../../../../src/components/WorkspaceMark';
import { WorkspacePicker } from '../../../../src/components/WorkspacePicker';
import { NewWorkspaceSheet } from '../../../../src/components/NewWorkspaceSheet';
import { GmailSettingsSheet } from '../../../../src/components/GmailSettingsSheet';
import { SyncFiltersSheet } from '../../../../src/components/SyncFiltersSheet';
import { BlacklistSheet } from '../../../../src/components/BlacklistSheet';
import { RenameWorkspaceSheet } from '../../../../src/components/RenameWorkspaceSheet';
import { CollaboratorsSheet } from '../../../../src/components/CollaboratorsSheet';
import { toUserMessage } from '../../../../src/errors';

const PLAN_LABEL: Record<string, string> = {
  FREE: 'Free',
  PRO: 'Pro',
  BUSINESS: 'Business',
};

export default function SettingsScreen() {
  const router = useRouter();
  const { user, userId, workspaceId, workspaces, client, switchWorkspace, refreshWorkspaces, bumpDataVersion } =
    useSession();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [gmailSheetOpen, setGmailSheetOpen] = useState(false);
  const [syncFiltersSheetOpen, setSyncFiltersSheetOpen] = useState(false);
  const [blacklistSheetOpen, setBlacklistSheetOpen] = useState(false);
  const [collaboratorsSheetOpen, setCollaboratorsSheetOpen] = useState(false);

  const activeWorkspace = workspaces.find((w) => w.id === workspaceId) ?? null;

  // Mirror the taxonomy screen: only the workspace OWNER may rename/reset/delete.
  const isOwner =
    !!activeWorkspace &&
    (activeWorkspace.owner.id === userId ||
      activeWorkspace.members.some((m) => m.user.id === userId && m.role === 'OWNER'));

  // ── Gmail data ────────────────────────────────────────────────────────────
  const [gmailConnection, setGmailConnection] = useState<GmailConnection | undefined>(undefined);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | undefined>(undefined);
  const [syncSettings, setSyncSettings] = useState<GmailSyncSettings | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    Promise.allSettled([
      client.gmailConnection(workspaceId),
      client.syncStatus(workspaceId),
      client.gmailSyncSettings(workspaceId),
    ]).then(([connResult, statusResult, settingsResult]) => {
      if (cancelled) return;
      setGmailConnection(connResult.status === 'fulfilled' ? connResult.value : null);
      setSyncStatus(statusResult.status === 'fulfilled' ? statusResult.value : null);
      setSyncSettings(settingsResult.status === 'fulfilled' ? settingsResult.value : null);
    });
    return () => { cancelled = true; };
  }, [workspaceId, client]);

  function refreshGmailData() {
    if (!workspaceId) return;
    Promise.allSettled([
      client.gmailConnection(workspaceId),
      client.syncStatus(workspaceId),
    ]).then(([connResult, statusResult]) => {
      setGmailConnection(connResult.status === 'fulfilled' ? connResult.value : null);
      setSyncStatus(statusResult.status === 'fulfilled' ? statusResult.value : null);
    });
  }

  // `undefined` means the first fetch hasn't resolved yet; `null` means no inbox.
  const gmailLoading = gmailConnection === undefined;
  const gmailSummary = gmailLoading
    ? '…'
    : !gmailConnection
      ? 'Not connected'
      : gmailConnection.status === 'DISCONNECTED'
        ? 'Disconnected'
        : gmailConnection.gmailAddress;
  const blacklistCount = syncSettings?.blacklistedSenderEmails.length ?? 0;
  const blacklistSummary = gmailLoading
    ? '…'
    : blacklistCount === 0
      ? 'None'
      : `${blacklistCount} blocked`;
  const enabledFilters = [
    syncSettings?.includeSpam ? 'Spam' : null,
    syncSettings?.includePromotions ? 'Promotions' : null,
  ].filter(Boolean);
  const syncFiltersSummary = gmailLoading
    ? '…'
    : enabledFilters.length > 0
      ? enabledFilters.join(', ')
      : 'Default';
  const planLabel = activeWorkspace
    ? PLAN_LABEL[activeWorkspace.plan] ?? activeWorkspace.plan
    : '';
  const members = activeWorkspace?.members ?? [];
  const collaboratorsSummary = members.length <= 1 ? 'Just you' : `${members.length} people`;

  // ── Rename ────────────────────────────────────────────────────────────────
  const [renameSheetOpen, setRenameSheetOpen] = useState(false);

  // ── Reset / Delete ──────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);

  const confirmReset = () => {
    if (!workspaceId) return;
    Alert.alert(
      'Reset workspace?',
      'This removes the Gmail connection, deletes all synced emails, and resets the plan to Inbox only. The workspace is kept. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                await client.resetWorkspace(workspaceId);
                bumpDataVersion(); // remounts the app subtree to re-seed wiped data
              } catch (err) {
                setBusy(false);
                Alert.alert('Reset failed', toUserMessage(err, 'Could not reset workspace'));
              }
            })();
          },
        },
      ],
    );
  };

  const confirmDelete = () => {
    if (!workspaceId) return;
    Alert.alert(
      'Delete workspace?',
      'Permanently delete this workspace and all of its data: emails, plan, settings, and Gmail connection. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                await client.deleteWorkspace(workspaceId);
                await refreshWorkspaces(); // active workspace repoints -> subtree remounts
              } catch (err) {
                setBusy(false);
                Alert.alert('Delete failed', toUserMessage(err, 'Could not delete workspace'));
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <ScreenContainer>
      <AppHeader variant="title" title="Settings" />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Account card — entry point to the user's account screen. */}
        <TouchableOpacity
          style={styles.accountCard}
          onPress={() => router.push('/(app)/account')}
        >
          <UserAvatar name={user?.name ?? null} email={user?.email ?? ''} />
          <View style={styles.accountText}>
            {user?.name ? (
              <Text style={styles.accountName} numberOfLines={1}>
                {user.name}
              </Text>
            ) : null}
            <Text style={styles.accountEmail} numberOfLines={1}>
              {user?.email ?? ''}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.ink4} />
        </TouchableOpacity>

        {/* Workspace — switch, plus owner-only name and plan. */}
        <SectionTitle>Workspace</SectionTitle>
        <SettingsGroup>
          <SettingsRow onPress={() => setPickerOpen(true)}>
            <WorkspaceMark name={activeWorkspace?.name ?? '?'} size={20} />
            <Text style={[styles.linkLabel, styles.linkLabelGrow]} numberOfLines={1}>
              {activeWorkspace?.name ?? 'No workspace'}
            </Text>
            <Text style={styles.rowMeta}>Switch</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.ink4} />
          </SettingsRow>

          {isOwner ? (
            <>
              <SettingsRow divider onPress={() => setRenameSheetOpen(true)}>
                <Ionicons name="create-outline" size={20} color={colors.ink3} />
                <Text style={styles.linkLabel}>Name</Text>
                <Text style={styles.linkMeta} numberOfLines={1}>
                  {activeWorkspace?.name ?? ''}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={colors.ink4} />
              </SettingsRow>

              <SettingsRow divider onPress={() => setCollaboratorsSheetOpen(true)}>
                <Ionicons name="people-outline" size={20} color={colors.ink3} />
                <Text style={styles.linkLabel}>Collaborators</Text>
                <Text style={styles.linkMeta} numberOfLines={1}>{collaboratorsSummary}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.ink4} />
              </SettingsRow>

              <SettingsRow divider onPress={() => router.push('/(app)/subscription')}>
                <Ionicons name="card-outline" size={20} color={colors.ink3} />
                <Text style={styles.linkLabel}>Subscription</Text>
                <Text style={styles.linkMeta} numberOfLines={1}>{planLabel}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.ink4} />
              </SettingsRow>
            </>
          ) : null}
        </SettingsGroup>

        {/* Owner-only management. Members get a read-only view. */}
        {isOwner ? (
          <>
            {/* Gmail — summary rows that open their settings in a sheet. */}
            <SectionTitle>Gmail</SectionTitle>
            <SettingsGroup>
              <SettingsRow onPress={() => setGmailSheetOpen(true)} disabled={gmailLoading}>
                <Ionicons name="mail-outline" size={20} color={colors.ink3} />
                <Text style={styles.linkLabel}>Inbox</Text>
                <Text style={styles.linkMeta} numberOfLines={1}>{gmailSummary}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.ink4} />
              </SettingsRow>

              <SettingsRow divider onPress={() => setSyncFiltersSheetOpen(true)} disabled={gmailLoading}>
                <Ionicons name="options-outline" size={20} color={colors.ink3} />
                <Text style={styles.linkLabel}>Sync filters</Text>
                <Text style={styles.linkMeta} numberOfLines={1}>{syncFiltersSummary}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.ink4} />
              </SettingsRow>

              <SettingsRow divider onPress={() => setBlacklistSheetOpen(true)} disabled={gmailLoading}>
                <Ionicons name="ban-outline" size={20} color={colors.ink3} />
                <Text style={styles.linkLabel}>Sender blacklist</Text>
                <Text style={styles.linkMeta} numberOfLines={1}>{blacklistSummary}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.ink4} />
              </SettingsRow>
            </SettingsGroup>

            <SectionTitle danger>Danger zone</SectionTitle>
            <SettingsGroup>
              <SettingsRow onPress={confirmReset} disabled={busy}>
                <Ionicons name="refresh-outline" size={20} color={colors.danger} />
                <Text style={[styles.linkLabel, styles.linkLabelGrow, styles.dangerLabel]}>Reset workspace</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.danger} />
              </SettingsRow>
              <SettingsRow divider onPress={confirmDelete} disabled={busy}>
                <Ionicons name="trash-outline" size={20} color={colors.danger} />
                <Text style={[styles.linkLabel, styles.linkLabelGrow, styles.dangerLabel]}>Delete workspace</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.danger} />
              </SettingsRow>
            </SettingsGroup>
          </>
        ) : null}
      </ScrollView>

      <WorkspacePicker
        visible={pickerOpen}
        workspaces={workspaces}
        currentWorkspaceId={workspaceId}
        onSelect={(id) => {
          switchWorkspace(id);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
        onCreateNew={() => {
          setPickerOpen(false);
          setNewWorkspaceOpen(true);
        }}
      />

      <NewWorkspaceSheet
        visible={newWorkspaceOpen}
        onClose={() => setNewWorkspaceOpen(false)}
      />

      {workspaceId ? (
        <>
          <RenameWorkspaceSheet
            visible={renameSheetOpen}
            onClose={() => setRenameSheetOpen(false)}
            workspaceId={workspaceId}
            client={client}
            currentName={activeWorkspace?.name ?? ''}
            onRenamed={refreshWorkspaces}
          />
          <GmailSettingsSheet
            visible={gmailSheetOpen}
            onClose={() => setGmailSheetOpen(false)}
            workspaceId={workspaceId}
            client={client}
            connection={gmailConnection ?? null}
            syncStatus={syncStatus ?? null}
            onDisconnected={refreshGmailData}
            onConnected={refreshGmailData}
          />
          <SyncFiltersSheet
            visible={syncFiltersSheetOpen}
            onClose={() => setSyncFiltersSheetOpen(false)}
            workspaceId={workspaceId}
            client={client}
            syncSettings={syncSettings}
            onChange={(updated) => setSyncSettings(updated)}
          />
          <BlacklistSheet
            visible={blacklistSheetOpen}
            onClose={() => setBlacklistSheetOpen(false)}
            workspaceId={workspaceId}
            client={client}
            emails={syncSettings?.blacklistedSenderEmails ?? []}
            onChange={(emails) =>
              setSyncSettings((prev) =>
                prev
                  ? { ...prev, blacklistedSenderEmails: emails }
                  : {
                      includeSpam: false,
                      includePromotions: false,
                      sortingPaused: false,
                      routeBulkToOther: true,
                      blacklistedSenderEmails: emails,
                    },
              )
            }
          />
          <CollaboratorsSheet
            visible={collaboratorsSheetOpen}
            onClose={() => setCollaboratorsSheetOpen(false)}
            members={members}
            currentUserId={userId}
          />
        </>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingVertical: space.xl,
    paddingBottom: space.xxl,
  },
  accountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    marginHorizontal: space.xl,
    padding: space.lg,
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  accountText: {
    flex: 1,
    minWidth: 0,
  },
  accountName: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
  },
  accountEmail: {
    fontSize: fontSize.md,
    color: colors.ink3,
  },
  rowMeta: {
    fontSize: fontSize.md,
    color: colors.ink4,
  },
  dangerLabel: {
    color: colors.danger,
  },
  linkLabel: {
    fontSize: fontSize.lg,
    color: colors.ink,
  },
  linkLabelGrow: {
    flex: 1,
  },
  linkMeta: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.ink4,
    textAlign: 'right',
  },
});
