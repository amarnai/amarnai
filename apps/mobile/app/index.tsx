import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@amarnai/tokens';
import { API_BASE_URL } from '../src/config';
import { useApiHealth } from '../src/health';

export default function HomeScreen() {
  const health = useApiHealth();

  const statusColor =
    health.status === 'ok'
      ? colors.ok
      : health.status === 'unreachable'
        ? colors.danger
        : colors.ink4;

  const statusLabel =
    health.status === 'ok'
      ? 'API OK'
      : health.status === 'checking'
        ? 'Checking API…'
        : `API unreachable: ${health.error}`;

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Amarnai</Text>

      <View style={styles.statusRow}>
        <View style={[styles.dot, { backgroundColor: statusColor }]} />
        <Text style={[styles.status, { color: statusColor }]}>{statusLabel}</Text>
      </View>

      <Text style={styles.url}>{API_BASE_URL}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  heading: {
    fontSize: 28,
    fontWeight: '600',
    color: colors.ink,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  status: {
    fontSize: 15,
    fontWeight: '500',
  },
  url: {
    fontSize: 13,
    color: colors.ink3,
  },
});
