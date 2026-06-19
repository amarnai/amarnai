import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, space, fontSize, fontWeight, radii } from '@amarnai/tokens';
import { useSession } from '../../src/auth/session';
import { UserAvatar } from '../../src/components/UserAvatar';

export default function AccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useSession();

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          Account
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.profile}>
          <UserAvatar name={user?.name ?? null} email={user?.email ?? ''} size={64} />
          {user?.name ? <Text style={styles.name}>{user.name}</Text> : null}
          <Text style={styles.email}>{user?.email ?? ''}</Text>
        </View>

        <TouchableOpacity style={styles.signOut} onPress={() => void signOut()}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
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
  backText: {
    fontSize: fontSize.lg,
    color: colors.accent,
    fontWeight: fontWeight.medium,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
    flex: 1,
  },
  content: {
    padding: space.xl,
  },
  profile: {
    alignItems: 'center',
    paddingVertical: space.xxl,
    gap: space.md,
  },
  name: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
  },
  email: {
    fontSize: fontSize.md,
    color: colors.ink3,
  },
  signOut: {
    borderColor: colors.line2,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: space.xl + space.xs,
    paddingVertical: space.lg - space.xxs,
    alignSelf: 'stretch',
    marginTop: space.xl,
  },
  signOutText: {
    fontSize: fontSize.lg,
    color: colors.ink2,
    fontWeight: fontWeight.medium,
    textAlign: 'center',
  },
});
