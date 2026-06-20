import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, space, fontSize, fontWeight } from '@amarnai/tokens';
import { authStyles } from './authStyles';

type Props = {
  onPress: () => void;
  submitting: boolean;
  disabled?: boolean;
};

export function GoogleSignInButton({ onPress, submitting, disabled }: Props) {
  return (
    <>
      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.dividerLine} />
      </View>
      <TouchableOpacity
        style={[authStyles.button, styles.googleButton, (submitting || disabled) && authStyles.buttonDisabled]}
        onPress={onPress}
        disabled={submitting || disabled}
      >
        {submitting ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <Text style={styles.googleButtonText}>Continue with Google</Text>
        )}
      </TouchableOpacity>
    </>
  );
}

const styles = StyleSheet.create({
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.line2,
  },
  dividerText: {
    fontSize: fontSize.sm,
    color: colors.ink4,
  },
  googleButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line2,
  },
  googleButtonText: {
    color: colors.ink,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
  },
});
