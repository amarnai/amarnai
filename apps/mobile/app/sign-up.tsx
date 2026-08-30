import { useRef, useState } from 'react';
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
import { Link, Redirect } from 'expo-router';
import { Trans } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { colors } from '@aziru/tokens';
import { PASSWORD_MIN_LENGTH } from '@aziru/shared';
import { useSession } from '../src/auth/session';
import { authStyles } from '../src/auth/authStyles';
import { GoogleSignInButton } from '../src/auth/GoogleSignInButton';
import { toUserMessage } from '../src/errors';

export default function SignUpScreen() {
  const { status, emailVerified, signUp, signInWithGoogle } = useSession();
  const { i18n } = useLingui();
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const busy = submitting || googleSubmitting;

  // After sign-up the account is signed in but unverified — route straight to
  // the verify screen (the app-boundary gate enforces the same thing).
  if (status === 'signedIn') {
    return <Redirect href={emailVerified === false ? '/verify-email' : '/'} />;
  }

  const canSubmit =
    email.trim().length > 0 &&
    password.length >= PASSWORD_MIN_LENGTH &&
    confirm.length > 0 &&
    !busy;

  async function onSubmit() {
    if (!canSubmit) return;
    Keyboard.dismiss();
    if (password !== confirm) {
      setError(i18n._(msg`Passwords do not match`));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await signUp(email.trim(), password);
    } catch (err) {
      setError(toUserMessage(err, i18n._(msg`Sign-up failed. Please try again.`)));
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
      <ScrollView
        contentContainerStyle={authStyles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={authStyles.form}>
          <Text style={authStyles.heading}>Amarnai</Text>
          <Text style={authStyles.subheading}><Trans>Create an account to triage your inbox</Trans></Text>

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
            editable={!submitting}
          />
          <TextInput
            ref={passwordRef}
            style={authStyles.input}
            placeholder={i18n._(msg`Password (min ${PASSWORD_MIN_LENGTH} characters)`)}
            placeholderTextColor={colors.ink4}
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            secureTextEntry
            returnKeyType="next"
            submitBehavior="submit"
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={() => confirmRef.current?.focus()}
            editable={!submitting}
          />
          <TextInput
            ref={confirmRef}
            style={authStyles.input}
            placeholder={i18n._(msg`Confirm password`)}
            placeholderTextColor={colors.ink4}
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            secureTextEntry
            returnKeyType="go"
            value={confirm}
            onChangeText={setConfirm}
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
              <Text style={authStyles.buttonText}><Trans>Create account</Trans></Text>
            )}
          </TouchableOpacity>

          <GoogleSignInButton
            onPress={onGoogleSignIn}
            submitting={googleSubmitting}
            disabled={submitting}
          />

          <Link href="/sign-in" style={authStyles.switchLink} disabled={busy}>
            <Text style={authStyles.switchText}>
              <Trans>
                Already have an account?{' '}
                <Text style={authStyles.switchTextStrong}>Sign in</Text>
              </Trans>
            </Text>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

