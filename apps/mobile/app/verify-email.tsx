import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Redirect } from 'expo-router';
import { Trans } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { colors, space, fontSize } from '@amarnai/tokens';
import { useSession } from '../src/auth/session';
import { authStyles } from '../src/auth/authStyles';
import { toUserMessage } from '../src/errors';

// How often to re-check verification while this screen is open. The user clicks
// the link in their email (which the web app handles), so we poll for the
// resulting state change rather than relying on a deep link back into the app.
const POLL_INTERVAL_MS = 4000;

export default function VerifyEmailScreen() {
  const { status, emailVerified, user, client, refresh, signOut } = useSession();
  const { i18n } = useLingui();

  const [resending, setResending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll for verification while the screen is mounted, and re-check whenever the
  // app returns to the foreground (the user likely just tapped the email link).
  useEffect(() => {
    if (status !== 'signedIn' || emailVerified !== false) return;
    const interval = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [status, emailVerified, refresh]);

  // Disable the resend button briefly after a send so the UI matches the API's
  // one-per-minute throttle instead of bouncing off a 429.
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [coolingDown, setCoolingDown] = useState(false);
  useEffect(() => () => {
    if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
  }, []);

  const onResend = useCallback(async () => {
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      await client.resendVerification();
      setNotice(i18n._(msg`Verification email sent. Check your inbox.`));
      setCoolingDown(true);
      cooldownTimer.current = setTimeout(() => setCoolingDown(false), 60_000);
    } catch (err) {
      setError(toUserMessage(err, i18n._(msg`Could not resend the email. Please try again.`)));
    } finally {
      setResending(false);
    }
  }, [client]);

  if (status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (status === 'signedOut') return <Redirect href="/sign-in" />;
  if (emailVerified === true) return <Redirect href="/" />;

  return (
    <View style={[authStyles.container, styles.padded]}>
      <View style={authStyles.form}>
        <Text style={authStyles.heading}><Trans>Verify your email</Trans></Text>
        <Text style={authStyles.subheading}>
          {user?.email
            ? i18n._(msg`We sent a verification link to ${user.email}. Open it to finish setting up your account.`)
            : i18n._(msg`We sent you a verification link. Open it to finish setting up your account.`)}
        </Text>

        <View style={styles.waitingRow}>
          <ActivityIndicator color={colors.ink4} />
          <Text style={styles.waitingText}><Trans>Waiting for verification…</Trans></Text>
        </View>

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {error ? <Text style={authStyles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[authStyles.button, (resending || coolingDown) && authStyles.buttonDisabled]}
          onPress={onResend}
          disabled={resending || coolingDown}
        >
          {resending ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <Text style={authStyles.buttonText}>
              {coolingDown ? <Trans>Email sent</Trans> : <Trans>Resend email</Trans>}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={authStyles.switchLink} onPress={() => void signOut()}>
          <Text style={authStyles.switchText}>
            <Trans>Wrong account? <Text style={authStyles.switchTextStrong}>Sign out</Text></Trans>
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  padded: {
    justifyContent: 'center',
    padding: space.xxl,
  },
  waitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
  },
  waitingText: {
    fontSize: fontSize.md,
    color: colors.ink3,
  },
  notice: {
    fontSize: fontSize.md,
    color: colors.ok,
    textAlign: 'center',
  },
});
