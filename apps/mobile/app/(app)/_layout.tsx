import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { colors } from '@amarnai/tokens';
import { useSession } from '../../src/auth/session';
import { TriageProvider } from '../../src/triage/TriageProvider';

export default function AppLayout() {
  const { status, client, workspaceId, userId } = useSession();

  if (status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (status === 'signedOut') return <Redirect href="/sign-in" />;

  if (!workspaceId || !userId) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <TriageProvider api={client} workspaceId={workspaceId} userId={userId}>
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
