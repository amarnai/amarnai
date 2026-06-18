import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@amarnai/tokens';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Amarnai</Text>
      <Text style={styles.accent}>{colors.accent}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  heading: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.ink,
  },
  accent: {
    fontSize: 14,
    color: colors.accent,
  },
});
