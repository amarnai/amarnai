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
    GoogleSignin.configure({ webClientId, offlineAccess: true, scopes: SCOPES });
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
      throw new Error('Google did not return an authorization code. Please try again.');
    }
    return { serverAuthCode, scope: (scopes ?? SCOPES).join(' ') };
  } catch (err) {
    if (err instanceof Error && err.message === 'cancelled') throw err;
    if ((err as { code?: string })?.code === statusCodes.SIGN_IN_CANCELLED) {
      throw new Error('cancelled');
    }
    throw new Error('Could not complete Google sign-in. Please try again.');
  }
}
