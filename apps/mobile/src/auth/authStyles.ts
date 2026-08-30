import { StyleSheet } from 'react-native';
import { colors, radii, space, fontSize, fontWeight } from '@aziru/tokens';

// Shared styling for the unauthenticated entry screens (sign-in, sign-up,
// verify-email) so the form, inputs, primary button, and cross-links look
// identical across them. Screen-specific extras (e.g. the sign-in health
// footer) stay local to each screen.
export const authStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: space.xxl,
  },
  form: {
    gap: space.lg,
  },
  heading: {
    fontSize: fontSize.display,
    fontWeight: fontWeight.bold,
    color: colors.ink,
    textAlign: 'center',
  },
  subheading: {
    fontSize: fontSize.lg,
    color: colors.ink3,
    textAlign: 'center',
    marginBottom: space.lg,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.line2,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    fontSize: fontSize.xl,
    color: colors.ink,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.md,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: space.xl,
    alignItems: 'center',
    marginTop: space.xs,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: colors.surface,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
  },
  switchLink: {
    alignSelf: 'center',
    marginTop: space.sm,
  },
  switchText: {
    fontSize: fontSize.md,
    color: colors.ink3,
    textAlign: 'center',
  },
  switchTextStrong: {
    color: colors.accent,
    fontWeight: fontWeight.semibold,
  },
});
