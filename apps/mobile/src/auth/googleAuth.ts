import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';

// gmail.readonly is the only Gmail scope the triage MVP needs. Google Sign-In
// always returns the basic identity (openid/email/profile) for the account.
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

// The serverAuthCode is minted for the Web OAuth client (webClientId). The API
// redeems it server-side with the Web client secret, yielding a refresh token
// that the server is allowed to refresh in the background (an on-device Android
// token is not). scope is forwarded so the API can enforce gmail.readonly.
export type GoogleAuthResult = {
  serverAuthCode: string;
  scope: string;
};

let configured = false;
function ensureConfigured(): void {
  const webClientId = process.env['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'] ?? '';
  if (!webClientId) {
    throw new Error(
      'Google OAuth is not configured. Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in your .env file.',
    );
  }
  if (!configured) {
    // offlineAccess: true is what makes Google return a serverAuthCode bound to
    // the Web client. The Android OAuth client (package + SHA-1) is matched
    // natively and is not passed here.
    //
    // forceCodeForRefreshToken: true makes Google mint a serverAuthCode that
    // exchanges into a refresh token even for accounts that already consented.
    // Without it, a returning user's exchange yields an access token but no
    // refresh token, and the API rejects the connection (we need offline access
    // for background sync).
    GoogleSignin.configure({
      webClientId,
      offlineAccess: true,
      forceCodeForRefreshToken: true,
      scopes: SCOPES,
    });
    configured = true;
  }
}

// Runs the native Google Sign-In flow and returns a serverAuthCode for the Web
// client, ready to POST to /auth/google or /workspaces/:id/gmail-connection.
// Throws with message 'cancelled' when the user dismisses the sheet.
export async function requestGoogleAuth(): Promise<GoogleAuthResult> {
  ensureConfigured();
  try {
    await GoogleSignin.hasPlayServices();
    const result = await GoogleSignin.signIn();

    // v13+ wraps the payload as { type, data }; tolerate the older flat shape.
    if ((result as { type?: string }).type === 'cancelled') {
      throw new Error('cancelled');
    }
    const data = (result as { data?: unknown }).data ?? result;
    const { serverAuthCode, scopes } = data as {
      serverAuthCode?: string | null;
      scopes?: string[];
    };

    if (!serverAuthCode) {
      // offlineAccess is on, so a missing code means the Web client id is wrong
      // (not a real Web OAuth client) rather than a native config problem.
      throw new Error('Google did not return an authorization code. Check EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is the Web client id.');
    }
    return { serverAuthCode, scope: (scopes ?? SCOPES).join(' ') };
  } catch (err) {
    if (err instanceof Error && err.message === 'cancelled') throw err;

    const code = (err as { code?: string })?.code;
    if (code === statusCodes.SIGN_IN_CANCELLED) {
      throw new Error('cancelled');
    }

    // Surface the native status code so failures are diagnosable from a build.
    // DEVELOPER_ERROR ('10') is not in statusCodes; it means the Android OAuth
    // client's package + SHA-1 don't match this binary (or no Android client
    // exists in the Google Cloud project).
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[googleAuth] signIn failed', { code, message });

    if (code === '10' || /DEVELOPER_ERROR/i.test(message)) {
      throw new Error(
        'Google rejected this app (DEVELOPER_ERROR). The Android OAuth client SHA-1 / package does not match this build.',
      );
    }
    if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      throw new Error('Google Play services is unavailable or outdated on this device.');
    }
    throw new Error(`Could not complete Google sign-in${code ? ` (${code})` : ''}. Please try again.`);
  }
}
