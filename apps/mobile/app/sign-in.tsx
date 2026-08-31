import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Link, Redirect } from 'expo-router';
import { Trans } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { colors, radii, space, fontSize } from '@aziru/tokens';
import { useSession } from '../src/auth/session';
import { authStyles } from '../src/auth/authStyles';
import { GoogleSignInButton } from '../src/auth/GoogleSignInButton';
import { toUserMessage } from '../src/errors';
import { API_BASE_URL } from '../src/config';
import { useApiHealth } from '../src/health';

export default function SignInScreen() {
  const { status, signIn, signInWithGoogle } = useSession();
  const { i18n } = useLingui();
  const health = useApiHealth();
  const passwordRef = useRef<TextInput>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const busy = submitting || googleSubmitting;

  if (status === 'signedIn') return <Redirect href="/" />;

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  async function onSubmit() {
    if (!canSubmit) return;
    Keyboard.dismiss();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(toUserMessage(err, i18n._(msg`Sign-in failed. Please try again.`)));
    } finally {
      setSubmitting(false);
    }
  }

  async function onGoogleSignIn() {
    if (busy) return;
    setError(null);
    setGoogleSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      if (err instanceof Error && err.message === 'cancelled') return;
      setError(toUserMessage(err, i18n._(msg`Google sign-in failed. Please try again.`)));
    } finally {
      setGoogleSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={authStyles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* keyboardShouldPersistTaps="handled" lets a tap focus another field
          while the keyboard is open, instead of being swallowed by the dismiss. */}
      <ScrollView
        contentContainerStyle={authStyles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={authStyles.form}>
          <Text style={authStyles.heading}>Aziru</Text>
          <Text style={authStyles.subheading}><Trans>Sign in to triage your inbox</Trans></Text>

          <TextInput
            style={authStyles.input}
            placeholder={i18n._(msg`Email`)}
            placeholderTextColor={colors.ink4}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            keyboardType="email-address"
            returnKeyType="next"
            submitBehavior="submit"
            value={email}
            onChangeText={setEmail}
            onSubmitEditing={() => passwordRef.current?.focus()}
            editable={!busy}
          />
          <TextInput
            ref={passwordRef}
            style={authStyles.input}
            placeholder={i18n._(msg`Password`)}
            placeholderTextColor={colors.ink4}
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            secureTextEntry
            returnKeyType="go"
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={onSubmit}
            editable={!busy}
          />

          <Link href="/forgot-password" style={styles.forgotLink} disabled={busy}>
            <Text style={authStyles.switchTextStrong}><Trans>Forgot password?</Trans></Text>
          </Link>

          {error ? <Text style={authStyles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[authStyles.button, !canSubmit && authStyles.buttonDisabled]}
            onPress={onSubmit}
            disabled={!canSubmit}
          >
            {submitting ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Text style={authStyles.buttonText}><Trans>Sign in</Trans></Text>
            )}
          </TouchableOpacity>

          <GoogleSignInButton
            onPress={onGoogleSignIn}
            submitting={googleSubmitting}
            disabled={submitting}
          />

          <Link href="/sign-up" style={authStyles.switchLink} disabled={busy}>
            <Text style={authStyles.switchText}>
              <Trans>
                Don't have an account?{' '}
                <Text style={authStyles.switchTextStrong}>Create one</Text>
              </Trans>
            </Text>
          </Link>
        </View>
      </ScrollView>

      {/* Dev-only connectivity indicator: shows which API host the app is
          hitting and whether it is reachable over LAN. Stripped from production
          builds so the API URL is never surfaced to end users. */}
      {__DEV__ ? (
        <View style={styles.footer}>
          <View style={[styles.dot, { backgroundColor: healthColor(health.status) }]} />
          <Text style={styles.footerText} numberOfLines={1}>
            {health.status === 'ok'
              ? API_BASE_URL
              : health.status === 'checking'
                ? `Checking ${API_BASE_URL}…`
                : `API unreachable: ${API_BASE_URL}`}
          </Text>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function healthColor(status: ReturnType<typeof useApiHealth>['status']): string {
  if (status === 'ok') return colors.ok;
  if (status === 'unreachable') return colors.danger;
  return colors.ink4;
}

const styles = StyleSheet.create({
  forgotLink: {
    alignSelf: 'flex-end',
    marginTop: -space.xs,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    paddingHorizontal: space.xxl,
    paddingBottom: space.xl,
  },
  dot: {
    width: space.md,
    height: space.md,
    borderRadius: radii.full,
  },
  footerText: {
    fontSize: fontSize.sm,
    color: colors.ink3,
    flexShrink: 1,
  },
});
