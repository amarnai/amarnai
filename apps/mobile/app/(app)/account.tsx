import { useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, space, fontSize, fontWeight, radii } from '@amarnai/tokens';
import { useSession } from '../../src/auth/session';
import { UserAvatar } from '../../src/components/UserAvatar';
import { EditNameSheet } from '../../src/components/EditNameSheet';

export default function AccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
                Alert.alert('Delete failed', err instanceof Error ? err.message : 'Could not delete account');
              }
            })();
          },
        },
      ],
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          Account
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Identity card */}
        <View style={styles.accountCard}>
          <UserAvatar name={user?.name ?? null} email={user?.email ?? ''} size={44} />
          <View style={styles.accountText}>
            {user?.name ? (
              <Text style={styles.accountName} numberOfLines={1}>{user.name}</Text>
            ) : null}
            <Text style={styles.accountEmail} numberOfLines={1}>{user?.email ?? ''}</Text>
          </View>
        </View>

        {/* Profile */}
        <Text style={styles.sectionTitle}>Profile</Text>
        <View style={styles.linkGroup}>
          <TouchableOpacity style={styles.linkRow} onPress={() => setEditNameOpen(true)}>
            <Ionicons name="person-outline" size={20} color={colors.ink3} />
            <Text style={styles.linkLabel}>Display name</Text>
            <Text style={styles.linkMeta} numberOfLines={1}>
              {user?.name ?? 'Not set'}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.ink4} />
          </TouchableOpacity>

          <View style={[styles.linkRow, styles.linkRowDivided]}>
            <Ionicons name="mail-outline" size={20} color={colors.ink3} />
            <Text style={styles.linkLabel}>Email</Text>
            <Text style={styles.linkMeta} numberOfLines={1}>{user?.email ?? ''}</Text>
          </View>
        </View>

        {/* Session */}
        <Text style={styles.sectionTitle}>Session</Text>
        <View style={styles.linkGroup}>
          <TouchableOpacity style={styles.linkRow} onPress={() => void signOut()}>
            <Ionicons name="log-out-outline" size={20} color={colors.ink3} />
            <Text style={styles.linkLabel}>Sign out</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.ink4} />
          </TouchableOpacity>
        </View>

        {/* Danger zone */}
        <Text style={[styles.sectionTitle, styles.dangerTitle]}>Danger zone</Text>
        <View style={styles.linkGroup}>
          <TouchableOpacity
            style={[styles.linkRow, deletePending && styles.btnDisabled]}
            onPress={confirmDelete}
            disabled={deletePending}
          >
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
            <Text style={[styles.linkLabel, styles.linkLabelGrow, styles.dangerLabel]}>
              {deletePending ? 'Deleting…' : 'Delete account'}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.danger} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      <EditNameSheet
        visible={editNameOpen}
        onClose={() => setEditNameOpen(false)}
        client={client}
        currentName={user?.name ?? null}
        onSaved={refresh}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingBottom: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line2,
    gap: space.lg,
  },
  back: {
    paddingVertical: space.xxs,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
    flex: 1,
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
  dangerLabel: {
    color: colors.danger,
  },
  linkGroup: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line2,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
  },
  linkRowDivided: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
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
  btnDisabled: {
    opacity: 0.5,
  },
});
