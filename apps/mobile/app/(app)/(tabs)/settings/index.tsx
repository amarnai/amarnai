import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, space, fontSize, fontWeight, radii } from '@amarnai/tokens';
import { useSession } from '../../../../src/auth/session';

export default function SettingsScreen() {
  const { signOut } = useSession();

  return (
    <View style={styles.container}>
      <Text style={styles.placeholder}>Settings coming soon</Text>

      <TouchableOpacity style={styles.signOut} onPress={() => void signOut()}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
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
    marginBottom: space.xxl,
  },
  signOut: {
    borderColor: colors.line2,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: space.xl + space.xs,
    paddingVertical: space.lg - space.xxs,
    alignSelf: 'stretch',
  },
  signOutText: {
    fontSize: fontSize.lg,
    color: colors.ink2,
    fontWeight: fontWeight.medium,
    textAlign: 'center',
  },
});
