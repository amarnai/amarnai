import { StyleSheet, Text, View } from 'react-native';
import { colors, space, fontSize } from '@amarnai/tokens';

export default function TaxonomyScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.placeholder}>Taxonomy coming soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  placeholder: {
    fontSize: fontSize.md,
    color: colors.ink3,
  },
});
