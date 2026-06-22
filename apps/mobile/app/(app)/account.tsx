import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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

  const [editNameOpen, setEditNameOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);

  function confirmDelete() {
    Alert.alert(
      'Delete account?',
      'Permanently delete your account and all associated data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDeletePending(true);
              try {
                await client.deleteMe();
                await signOut();
              } catch (err) {
                setDeletePending(false);
                Alert.alert('Delete failed', toUserMessage(err, 'Could not delete account. Please try again.'));
              }
            })();
          },
        },
      ],
    );
  }

  return (
    <ScreenContainer>
      <BackHeader title="Account" onBack={() => router.back()} />

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
            <Text style={styles.linkLabel}>Sign out</Text>
          </SettingsRow>
        </SettingsGroup>

        {/* Profile */}
        <SectionTitle>Profile</SectionTitle>
        <SettingsGroup>
          <SettingsRow onPress={() => setEditNameOpen(true)}>
            <Ionicons name="person-outline" size={20} color={colors.ink3} />
            <Text style={styles.linkLabel}>Name</Text>
            <Text style={styles.linkMeta} numberOfLines={1}>
              {user?.name ?? 'Not set'}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.ink4} />
          </SettingsRow>
          <SettingsRow divider>
            <Ionicons name="mail-outline" size={20} color={colors.ink3} />
            <Text style={styles.linkLabel}>Email</Text>
            <Text style={styles.linkMeta} numberOfLines={1}>{user?.email ?? ''}</Text>
          </SettingsRow>
        </SettingsGroup>

        {/* Danger zone */}
        <SectionTitle danger>Danger zone</SectionTitle>
        <SettingsGroup>
          <SettingsRow onPress={confirmDelete} disabled={deletePending}>
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
            <Text style={[styles.linkLabel, styles.linkLabelGrow, styles.dangerLabel]}>
              {deletePending ? 'Deleting…' : 'Delete account'}
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
