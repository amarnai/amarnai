import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, fontSize, fontWeight, radii } from '@amarnai/tokens';
import { useSession } from '../../../../src/auth/session';
import { AppHeader } from '../../../../src/components/AppHeader';
import { UserAvatar } from '../../../../src/components/UserAvatar';
import { WorkspaceMark } from '../../../../src/components/WorkspaceMark';
import { WorkspacePicker } from '../../../../src/components/WorkspacePicker';
import { NewWorkspaceSheet } from '../../../../src/components/NewWorkspaceSheet';

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback;

export default function SettingsScreen() {
  const router = useRouter();
  const { user, userId, workspaceId, workspaces, client, switchWorkspace, refreshWorkspaces, bumpDataVersion } =
    useSession();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);

  const activeWorkspace = workspaces.find((w) => w.id === workspaceId) ?? null;

  // Mirror the taxonomy screen: only the workspace OWNER may rename/reset/delete.
  const isOwner =
    !!activeWorkspace &&
    (activeWorkspace.owner.id === userId ||
      activeWorkspace.members.some((m) => m.user.id === userId && m.role === 'OWNER'));

  // ── Rename ────────────────────────────────────────────────────────────────
  const [name, setName] = useState(activeWorkspace?.name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Keep the input in sync when the active workspace changes (switch) or its
  // name updates (after a successful rename re-fetches the list).
  useEffect(() => {
    setName(activeWorkspace?.name ?? '');
    setNameError(null);
  }, [activeWorkspace?.id, activeWorkspace?.name]);

  const trimmedName = name.trim();
  const nameDirty = !!activeWorkspace && trimmedName.length > 0 && trimmedName !== activeWorkspace.name;

  const handleRename = async () => {
    if (!workspaceId || !nameDirty) return;
    setSavingName(true);
    setNameError(null);
    try {
      await client.updateWorkspace(workspaceId, trimmedName);
      await refreshWorkspaces();
    } catch (err) {
      setNameError(errorMessage(err, 'Could not rename workspace'));
    } finally {
      setSavingName(false);
    }
  };

  // ── Reset / Delete ──────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);

  const confirmReset = () => {
    if (!workspaceId) return;
    Alert.alert(
      'Reset workspace?',
      'This removes the Gmail connection, deletes all synced emails, and resets the taxonomy to Inbox only. The workspace is kept. This cannot be undone.',
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
                Alert.alert('Reset failed', errorMessage(err, 'Could not reset workspace'));
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
      'Permanently delete this workspace and all of its data: emails, taxonomy, settings, and Gmail connection. This cannot be undone.',
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
                Alert.alert('Delete failed', errorMessage(err, 'Could not delete workspace'));
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
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

        {/* Workspace — current workspace, tap to switch. */}
        <Text style={styles.sectionTitle}>Workspace</Text>
        <TouchableOpacity style={styles.row} onPress={() => setPickerOpen(true)}>
          <WorkspaceMark name={activeWorkspace?.name ?? '?'} size={24} />
          <Text style={styles.rowText} numberOfLines={1}>
            {activeWorkspace?.name ?? 'No workspace'}
          </Text>
          <Text style={styles.rowMeta}>Switch</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.ink4} />
        </TouchableOpacity>

        {/* Owner-only management. Members get a read-only view. */}
        {isOwner ? (
          <>
            <Text style={styles.sectionTitle}>Workspace name</Text>
            <View style={styles.nameSection}>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Workspace name"
                placeholderTextColor={colors.ink4}
                maxLength={100}
                editable={!savingName}
                returnKeyType="done"
                onSubmitEditing={() => void handleRename()}
              />
              <TouchableOpacity
                style={[styles.saveBtn, (!nameDirty || savingName) && styles.btnDisabled]}
                onPress={() => void handleRename()}
                disabled={!nameDirty || savingName}
              >
                {savingName ? (
                  <ActivityIndicator color={colors.surface} size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
            {nameError ? <Text style={styles.errorText}>{nameError}</Text> : null}

            <Text style={[styles.sectionTitle, styles.dangerTitle]}>Danger zone</Text>
            <View style={styles.dangerSection}>
              <TouchableOpacity
                style={[styles.dangerBtn, busy && styles.btnDisabled]}
                onPress={confirmReset}
                disabled={busy}
              >
                <Text style={styles.dangerBtnText}>Reset workspace</Text>
              </TouchableOpacity>
              <Text style={styles.dangerHint}>
                Remove the Gmail connection, delete synced emails, and reset the taxonomy to Inbox.
              </Text>

              <TouchableOpacity
                style={[styles.dangerBtn, styles.deleteBtn, busy && styles.btnDisabled]}
                onPress={confirmDelete}
                disabled={busy}
              >
                <Text style={[styles.dangerBtnText, styles.deleteBtnText]}>Delete workspace</Text>
              </TouchableOpacity>
              <Text style={styles.dangerHint}>
                Permanently delete this workspace and everything in it.
              </Text>
            </View>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
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
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.ink3,
    textTransform: 'uppercase',
    paddingHorizontal: space.xl,
    paddingTop: space.xxl,
    paddingBottom: space.md,
  },
  dangerTitle: {
    color: colors.danger,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line2,
  },
  rowText: {
    flex: 1,
    fontSize: fontSize.lg,
    color: colors.ink,
  },
  rowMeta: {
    fontSize: fontSize.md,
    color: colors.ink4,
  },
  nameSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xl,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radii.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontSize: fontSize.lg,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  saveBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.md + space.xxs,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    color: colors.surface,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  errorText: {
    color: colors.danger,
    fontSize: fontSize.md,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
  },
  dangerSection: {
    paddingHorizontal: space.xl,
    gap: space.md,
  },
  dangerBtn: {
    borderWidth: 1,
    borderColor: colors.dangerLine,
    borderRadius: radii.md,
    paddingVertical: space.lg - space.xxs,
    alignItems: 'center',
    backgroundColor: colors.dangerSoft,
  },
  dangerBtnText: {
    color: colors.danger,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.medium,
  },
  deleteBtn: {
    marginTop: space.lg,
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  deleteBtnText: {
    color: colors.surface,
    fontWeight: fontWeight.semibold,
  },
  dangerHint: {
    fontSize: fontSize.sm,
    color: colors.ink3,
  },
});
