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
import { Redirect } from 'expo-router';
import { colors, radii } from '@amarnai/tokens';
import { useSession } from '../src/auth/session';
import { API_BASE_URL } from '../src/config';
import { useApiHealth } from '../src/health';

export default function SignInScreen() {
  const { status, signIn } = useSession();
  const health = useApiHealth();
  const passwordRef = useRef<TextInput>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'signedIn') return <Redirect href="/" />;

  const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting;

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

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* keyboardShouldPersistTaps="handled" lets a tap focus another field
          while the keyboard is open, instead of being swallowed by the dismiss. */}
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={styles.form}>
          <Text style={styles.heading}>Amarnai</Text>
          <Text style={styles.subheading}>Sign in to triage your inbox</Text>

          <TextInput
            style={styles.input}
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
            editable={!submitting}
          />
          <TextInput
            ref={passwordRef}
            style={styles.input}
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
            editable={!submitting}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.button, !canSubmit && styles.buttonDisabled]}
            onPress={onSubmit}
            disabled={!canSubmit}
          >
            {submitting ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </TouchableOpacity>
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
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  form: {
    gap: 12,
  },
  heading: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.ink,
    textAlign: 'center',
  },
  subheading: {
    fontSize: 15,
    color: colors.ink3,
    textAlign: 'center',
    marginBottom: 12,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.line2,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  footerText: {
    fontSize: 12,
    color: colors.ink3,
    flexShrink: 1,
  },
});
