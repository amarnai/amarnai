import { AuthRequest, makeRedirectUri, ResponseType } from 'expo-auth-session';

const DISCOVERY = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
};

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
];

// Must match the redirect URI registered for the Android OAuth client.
// Google's Android clients enforce the reverse-DNS package scheme with a single slash.
export const GOOGLE_REDIRECT_URI = makeRedirectUri({ native: 'com.amarnai.app:/oauth2redirect' });

export type GoogleAuthResult = {
  accessToken: string;
  refreshToken: string;
  scope: string;
};

// Runs the PKCE flow in the system browser, exchanges the auth code on-device
// (Android OAuth clients are public clients — Google blocks server-side exchange),
// and returns tokens ready for posting to /auth/google or
// /workspaces/:id/gmail-connection.
// Throws with message 'cancelled' when the user dismisses the browser.
export async function requestGoogleAuth(): Promise<GoogleAuthResult> {
  const clientId = process.env['EXPO_PUBLIC_GOOGLE_MOBILE_CLIENT_ID'] ?? '';
  if (!clientId) {
    throw new Error(
      'Google OAuth is not configured. Set EXPO_PUBLIC_GOOGLE_MOBILE_CLIENT_ID in your .env file.',
    );
  }

  const request = new AuthRequest({
    clientId,
    scopes: SCOPES,
    redirectUri: GOOGLE_REDIRECT_URI,
    responseType: ResponseType.Code,
    usePKCE: true,
    extraParams: {
      access_type: 'offline',
      prompt: 'consent',
    },
  });

  const result = await request.promptAsync(DISCOVERY);

  if (result.type === 'cancel' || result.type === 'dismiss') {
    throw new Error('cancelled');
  }
  if (result.type !== 'success' || !result.params['code']) {
    throw new Error('Google sign-in failed. Please try again.');
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: result.params['code']!,
      client_id: clientId,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: request.codeVerifier ?? '',
    }).toString(),
  });

  if (!tokenRes.ok) {
    // Google's error_description is a developer-facing diagnostic; log it for
    // debugging but show the user a generic, actionable message.
    if (__DEV__) {
      const body = (await tokenRes.json().catch(() => ({}))) as {
        error?: string;
        error_description?: string;
      };
      console.warn('Google token exchange failed:', body.error_description ?? body.error);
    }
    throw new Error('Could not complete Google sign-in. Please try again.');
  }

  type TokenBody = { access_token?: string; refresh_token?: string; scope?: string };
  const tokenBody = (await tokenRes.json()) as TokenBody;
  if (!tokenBody.access_token) {
    throw new Error('Could not complete Google sign-in. Please try again.');
  }
  if (!tokenBody.refresh_token) {
    throw new Error('Google did not grant offline access. Please try signing in again.');
  }

  return {
    accessToken: tokenBody.access_token,
    refreshToken: tokenBody.refresh_token,
    scope: tokenBody.scope ?? '',
  };
}
