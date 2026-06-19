import { useState } from 'react';
import { useRouter } from 'expo-router';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, space, fontSize, fontWeight, radii } from '@amarnai/tokens';
import { useSession } from '../../src/auth/session';
import { UserAvatar } from '../../src/components/UserAvatar';

export default function AccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, client, refresh, signOut } = useSession();

  const [nameValue, setNameValue] = useState(user?.name ?? '');
  const [namePending, setNamePending] = useState(false);
  const [nameSuccess, setNameSuccess] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [deletePending, setDeletePending] = useState(false);

  async function saveName() {
    setNamePending(true);
    setNameError(null);
    setNameSuccess(false);
    try {
      await client.updateMe(nameValue.trim());
      await refresh();
      setNameSuccess(true);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'Could not update name');
    } finally {
      setNamePending(false);
    }
  }

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
        {/* Profile card */}
        <View style={styles.profileCard}>
          <UserAvatar name={user?.name ?? null} email={user?.email ?? ''} size={56} />
          <View style={styles.profileText}>
            {user?.name ? (
              <Text style={styles.profileName} numberOfLines={1}>{user.name}</Text>
            ) : null}
            <Text style={styles.profileEmail} numberOfLines={1}>{user?.email ?? ''}</Text>
          </View>
        </View>

        {/* Profile section */}
        <Text style={styles.sectionTitle}>Profile</Text>
        <View style={styles.formGroup}>
          <Text style={styles.label}>Display name</Text>
          <TextInput
            style={styles.input}
            value={nameValue}
            onChangeText={(v) => { setNameValue(v); setNameSuccess(false); setNameError(null); }}
            placeholder="Your name"
            placeholderTextColor={colors.ink4}
            maxLength={100}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={() => void saveName()}
          />
        </View>
        <View style={styles.formGroup}>
          <Text style={styles.label}>Email</Text>
          <View style={styles.inputReadonly}>
            <Text style={styles.inputReadonlyText} numberOfLines={1}>{user?.email ?? ''}</Text>
          </View>
        </View>
        {nameError ? <Text style={styles.errorText}>{nameError}</Text> : null}
        {nameSuccess ? <Text style={styles.successText}>Name updated.</Text> : null}
        <TouchableOpacity
          style={[styles.btnPrimary, namePending && styles.btnDisabled]}
          onPress={() => void saveName()}
          disabled={namePending}
        >
          <Text style={styles.btnPrimaryText}>{namePending ? 'Saving…' : 'Save changes'}</Text>
        </TouchableOpacity>

        {/* Session section */}
        <Text style={styles.sectionTitle}>Session</Text>
        <View style={styles.linkGroup}>
          <TouchableOpacity style={styles.linkRow} onPress={() => void signOut()}>
            <Text style={styles.linkLabel}>Sign out</Text>
          </TouchableOpacity>
        </View>

        {/* Danger zone */}
        <Text style={[styles.sectionTitle, styles.dangerTitle]}>Danger zone</Text>
        <View style={styles.dangerSection}>
          <TouchableOpacity
            style={[styles.deleteBtn, deletePending && styles.btnDisabled]}
            onPress={confirmDelete}
            disabled={deletePending}
          >
            <Text style={styles.deleteBtnText}>
              {deletePending ? 'Deleting…' : 'Delete account'}
            </Text>
          </TouchableOpacity>
          <Text style={styles.dangerHint}>
            Permanently delete your account and all associated data. This cannot be undone.
          </Text>
        </View>
      </ScrollView>
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
  profileCard: {
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
  profileText: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
  },
  profileEmail: {
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
  formGroup: {
    paddingHorizontal: space.xl,
    marginBottom: space.md,
    gap: space.xs,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.ink2,
    marginBottom: space.xxs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radii.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg - space.xxs,
    fontSize: fontSize.lg,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  inputReadonly: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg - space.xxs,
    backgroundColor: colors.bg,
  },
  inputReadonlyText: {
    fontSize: fontSize.lg,
    color: colors.ink3,
  },
  errorText: {
    fontSize: fontSize.sm,
    color: colors.danger,
    paddingHorizontal: space.xl,
    marginBottom: space.md,
  },
  successText: {
    fontSize: fontSize.sm,
    color: colors.accentInk,
    paddingHorizontal: space.xl,
    marginBottom: space.md,
  },
  btnPrimary: {
    marginHorizontal: space.xl,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: space.lg - space.xxs,
    alignItems: 'center',
  },
  btnPrimaryText: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.surface,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  linkGroup: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line2,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
  },
  linkLabel: {
    fontSize: fontSize.lg,
    color: colors.ink,
  },
  dangerSection: {
    paddingHorizontal: space.xl,
    gap: space.md,
  },
  deleteBtn: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radii.md,
    paddingVertical: space.lg - space.xxs,
    alignItems: 'center',
    backgroundColor: colors.danger,
  },
  deleteBtnText: {
    color: colors.surface,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  dangerHint: {
    fontSize: fontSize.sm,
    color: colors.ink3,
  },
});
