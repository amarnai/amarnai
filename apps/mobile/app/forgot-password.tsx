import { useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Link } from 'expo-router';
import { Trans } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { colors } from '@amarnai/tokens';
import { useSession } from '../src/auth/session';
import { authStyles } from '../src/auth/authStyles';

export default function ForgotPasswordScreen() {
  const { requestPasswordReset } = useSession();
  const { i18n } = useLingui();

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const canSubmit = email.trim().length > 0 && !submitting;

  async function onSubmit() {
    if (!canSubmit) return;
    Keyboard.dismiss();
    setError(null);
    setSubmitting(true);
    try {
      await requestPasswordReset(email.trim());
      setSubmitted(true);
    } catch {
      // Only a network failure reaches here — the API itself always succeeds.
      setError(i18n._(msg`Could not reach the server. Please check your connection and try again.`));
    } finally {
      setSubmitting(false);
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
          <Text style={authStyles.heading}><Trans>Reset password</Trans></Text>

          {submitted ? (
            <>
              <Text style={authStyles.subheading}>
                <Trans>
                  If an account exists for that email, we&apos;ve sent a reset link. Open it to choose
                  a new password, then sign in.
                </Trans>
              </Text>
              <Link href="/sign-in" style={authStyles.switchLink}>
                <Text style={authStyles.switchText}>
                  <Text style={authStyles.switchTextStrong}><Trans>Back to sign in</Trans></Text>
                </Text>
              </Link>
            </>
          ) : (
            <>
              <Text style={authStyles.subheading}>
                <Trans>Enter your email and we&apos;ll send you a link to reset your password.</Trans>
              </Text>

              <TextInput
                style={authStyles.input}
                placeholder={i18n._(msg`Email`)}
                placeholderTextColor={colors.ink4}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                keyboardType="email-address"
                returnKeyType="go"
                value={email}
                onChangeText={setEmail}
                onSubmitEditing={onSubmit}
                editable={!submitting}
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
                  <Text style={authStyles.buttonText}><Trans>Send reset link</Trans></Text>
                )}
              </TouchableOpacity>

              <Link href="/sign-in" style={authStyles.switchLink} disabled={submitting}>
                <Text style={authStyles.switchText}>
                  <Trans>Remembered it? <Text style={authStyles.switchTextStrong}>Sign in</Text></Trans>
                </Text>
              </Link>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
