import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Trans } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { colors, space, fontSize, fontWeight, radii } from '@amarnai/tokens';
import { useSession } from '../../src/auth/session';
import { UserAvatar } from '../../src/components/UserAvatar';
import { ScreenContainer } from '../../src/components/ScreenContainer';
import { BackHeader } from '../../src/components/BackHeader';
import { SectionTitle } from '../../src/components/SectionTitle';
import { SettingsGroup, SettingsRow } from '../../src/components/SettingsGroup';
import { EditNameSheet } from '../../src/components/EditNameSheet';
import { toUserMessage } from '../../src/errors';

export default function AccountScreen() {
  const router = useRouter();
  const { user, client, refresh, signOut } = useSession();
  const { i18n } = useLingui();

  const [editNameOpen, setEditNameOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);

  // Weekly reminder preference. Loaded from /auth/me (the session `user` is
  // derived from workspace membership and doesn't carry it). null while loading.
  const [remindersEnabled, setRemindersEnabled] = useState<boolean | null>(null);
  const [remindersSaving, setRemindersSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void client
      .me()
      .then((me) => {
        if (active) setRemindersEnabled(me.lifecycleEmailsEnabled);
      })
      .catch(() => {
        /* leave null — the row simply stays disabled until it loads */
      });
    return () => {
      active = false;
    };
  }, [client]);

  function toggleReminders(next: boolean) {
    const previous = remindersEnabled;
    setRemindersEnabled(next); // optimistic
    setRemindersSaving(true);
    void (async () => {
      try {
        await client.updateMe({ lifecycleEmailsEnabled: next });
      } catch (err) {
        setRemindersEnabled(previous ?? null); // revert on failure
        Alert.alert(i18n._(msg`Update failed`), toUserMessage(err, i18n._(msg`Could not update your reminder setting.`)));
      } finally {
        setRemindersSaving(false);
      }
    })();
  }

  function confirmDelete() {
    Alert.alert(
      i18n._(msg`Delete account?`),
      i18n._(msg`Permanently delete your account and all associated data. This cannot be undone.`),
      [
        { text: i18n._(msg`Cancel`), style: 'cancel' },
        {
          text: i18n._(msg`Delete`),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDeletePending(true);
              try {
                await client.deleteMe();
                await signOut();
              } catch (err) {
                setDeletePending(false);
                Alert.alert(i18n._(msg`Delete failed`), toUserMessage(err, i18n._(msg`Could not delete account. Please try again.`)));
              }
            })();
          },
        },
      ],
    );
  }

  return (
    <ScreenContainer>
      <BackHeader title={i18n._(msg`Account`)} onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Identity card + sign-out */}
        <View style={styles.accountCard}>
          <UserAvatar name={user?.name ?? null} email={user?.email ?? ''} />
          <View style={styles.accountText}>
            {user?.name ? (
              <Text style={styles.accountName} numberOfLines={1}>{user.name}</Text>
            ) : null}
            <Text style={styles.accountEmail} numberOfLines={1}>{user?.email ?? ''}</Text>
          </View>
        </View>

        <SettingsGroup>
          <SettingsRow onPress={() => void signOut()}>
            <Ionicons name="log-out-outline" size={20} color={colors.ink3} />
            <Text style={styles.linkLabel}><Trans>Sign out</Trans></Text>
          </SettingsRow>
        </SettingsGroup>

        {/* Profile */}
        <SectionTitle><Trans>Profile</Trans></SectionTitle>
        <SettingsGroup>
          <SettingsRow onPress={() => setEditNameOpen(true)}>
            <Ionicons name="person-outline" size={20} color={colors.ink3} />
            <Text style={styles.linkLabel}><Trans>Name</Trans></Text>
            <Text style={styles.linkMeta} numberOfLines={1}>
              {user?.name ?? i18n._(msg`Not set`)}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.ink4} />
          </SettingsRow>
          <SettingsRow divider>
            <Ionicons name="mail-outline" size={20} color={colors.ink3} />
            <Text style={styles.linkLabel}><Trans>Email</Trans></Text>
            <Text style={styles.linkMeta} numberOfLines={1}>{user?.email ?? ''}</Text>
          </SettingsRow>
        </SettingsGroup>

        {/* Notifications */}
        <SectionTitle><Trans>Notifications</Trans></SectionTitle>
        <SettingsGroup>
          <SettingsRow>
            <Ionicons name="notifications-outline" size={20} color={colors.ink3} />
            <Text style={[styles.linkLabel, styles.linkLabelGrow]}><Trans>Weekly inbox reminder</Trans></Text>
            <Switch
              value={remindersEnabled ?? false}
              onValueChange={toggleReminders}
              disabled={remindersEnabled === null || remindersSaving}
              trackColor={{ false: colors.line2, true: colors.accentLine }}
              thumbColor={remindersEnabled ? colors.accent : colors.ink4}
            />
          </SettingsRow>
        </SettingsGroup>

        {/* Danger zone */}
        <SectionTitle danger><Trans>Danger zone</Trans></SectionTitle>
        <SettingsGroup>
          <SettingsRow onPress={confirmDelete} disabled={deletePending}>
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
            <Text style={[styles.linkLabel, styles.linkLabelGrow, styles.dangerLabel]}>
              {deletePending ? <Trans>Deleting…</Trans> : <Trans>Delete account</Trans>}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.danger} />
          </SettingsRow>
        </SettingsGroup>
      </ScrollView>

      <EditNameSheet
        visible={editNameOpen}
        onClose={() => setEditNameOpen(false)}
        client={client}
        currentName={user?.name ?? null}
        onSaved={refresh}
      />
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
    marginBottom: space.lg,
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
  dangerLabel: {
    color: colors.danger,
  },
});
