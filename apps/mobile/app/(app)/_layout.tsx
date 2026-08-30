import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { colors } from '@aziru/tokens';
import { useSession } from '../../src/auth/session';
import { TriageProvider } from '../../src/triage/TriageProvider';

export default function AppLayout() {
  const { status, client, workspaceId, userId, dataVersion, emailVerified } = useSession();

  if (status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (status === 'signedOut') return <Redirect href="/sign-in" />;
  // Gate unverified accounts (fresh sign-up) at the app boundary so a deep link
  // can't bypass the verify screen. null means "unknown" (me() not resolved) and
  // is not gated. Verifying creates the user's default workspace web-side.
  if (emailVerified === false) return <Redirect href="/verify-email" />;

  if (!workspaceId || !userId) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    // Key on workspaceId + dataVersion so the provider remounts and re-seeds
    // triage state (folders + threads) when the workspace changes OR its data is
    // wiped in place (reset). Remounting the subtree also refetches the taxonomy
    // screen's queries.
    <TriageProvider
      key={`${workspaceId}:${dataVersion}`}
      api={client}
      workspaceId={workspaceId}
      userId={userId}
    >
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}
      />
    </TriageProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
