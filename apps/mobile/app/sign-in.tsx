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
import { colors, radii, space, fontSize } from '@amarnai/tokens';
import { useSession } from '../src/auth/session';
import { authStyles } from '../src/auth/authStyles';
import { GoogleSignInButton } from '../src/auth/GoogleSignInButton';
import { API_BASE_URL } from '../src/config';
import { useApiHealth } from '../src/health';

export default function SignInScreen() {
  const { status, signIn, signInWithGoogle } = useSession();
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
      setError(err instanceof Error ? err.message : 'Sign-in failed');
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
      const msg = err instanceof Error ? err.message : 'Google sign-in failed';
      if (msg !== 'cancelled') setError(msg);
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
          <Text style={authStyles.heading}>Amarnai</Text>
          <Text style={authStyles.subheading}>Sign in to triage your inbox</Text>

          <TextInput
            style={authStyles.input}
            placeholder="Email"
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
            placeholder="Password"
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

          {error ? <Text style={authStyles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[authStyles.button, !canSubmit && authStyles.buttonDisabled]}
            onPress={onSubmit}
            disabled={!canSubmit}
          >
            {submitting ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Text style={authStyles.buttonText}>Sign in</Text>
            )}
          </TouchableOpacity>

          <GoogleSignInButton
            onPress={onGoogleSignIn}
            submitting={googleSubmitting}
            disabled={submitting}
          />

          <Link href="/sign-up" style={authStyles.switchLink} disabled={busy}>
            <Text style={authStyles.switchText}>
              Don't have an account?{' '}
              <Text style={authStyles.switchTextStrong}>Create one</Text>
            </Text>
          </Link>
        </View>
      </ScrollView>

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
    </KeyboardAvoidingView>
  );
}

function healthColor(status: ReturnType<typeof useApiHealth>['status']): string {
  if (status === 'ok') return colors.ok;
  if (status === 'unreachable') return colors.danger;
  return colors.ink4;
}

const styles = StyleSheet.create({
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
