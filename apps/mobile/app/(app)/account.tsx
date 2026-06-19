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
import { colors, space, fontSize, fontWeight, radii } from '@amarnai/tokens';
import { useSession } from '../../src/auth/session';
import { UserAvatar } from '../../src/components/UserAvatar';
import { ScreenContainer } from '../../src/components/ScreenContainer';
import { BackHeader } from '../../src/components/BackHeader';
import { SectionTitle } from '../../src/components/SectionTitle';
import { SettingsGroup, SettingsRow } from '../../src/components/SettingsGroup';
import { FormInput } from '../../src/components/FormInput';
import { PrimaryButton } from '../../src/components/PrimaryButton';

export default function AccountScreen() {
  const router = useRouter();
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
    <ScreenContainer>
      <BackHeader title="Account" onBack={() => router.back()} />

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
        <SectionTitle>Profile</SectionTitle>
        <View style={styles.formGroup}>
          <Text style={styles.label}>Display name</Text>
          <FormInput
            value={nameValue}
            onChangeText={(v) => { setNameValue(v); setNameSuccess(false); setNameError(null); }}
            placeholder="Your name"
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
        <PrimaryButton
          label={namePending ? 'Saving…' : 'Save changes'}
          onPress={() => void saveName()}
          loading={namePending}
          style={styles.saveBtn}
        />

        {/* Session section */}
        <SectionTitle>Session</SectionTitle>
        <SettingsGroup>
          <SettingsRow onPress={() => void signOut()}>
            <Text style={styles.linkLabel}>Sign out</Text>
          </SettingsRow>
        </SettingsGroup>

        {/* Danger zone */}
        <SectionTitle danger>Danger zone</SectionTitle>
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
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
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
  inputReadonly: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
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
  saveBtn: {
    marginHorizontal: space.xl,
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
    paddingVertical: space.md,
    alignItems: 'center',
    backgroundColor: colors.danger,
  },
  deleteBtnText: {
    color: colors.surface,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  dangerHint: {
    fontSize: fontSize.sm,
    color: colors.ink3,
  },
});
