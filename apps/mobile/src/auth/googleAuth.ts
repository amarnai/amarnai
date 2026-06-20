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
    const errDesc = result.type === 'error'
      ? (result.error?.message ?? 'Google sign-in failed')
      : 'Google sign-in failed';
    throw new Error(errDesc);
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
    type ErrBody = { error?: string; error_description?: string };
    const body = (await tokenRes.json().catch(() => ({}))) as ErrBody;
    throw new Error(body.error_description ?? body.error ?? 'Token exchange failed');
  }

  type TokenBody = { access_token?: string; refresh_token?: string; scope?: string };
  const tokenBody = (await tokenRes.json()) as TokenBody;
  if (!tokenBody.access_token) throw new Error('No access_token in Google response');
  if (!tokenBody.refresh_token) {
    throw new Error('No refresh_token — sign in again to grant offline access');
  }

  return {
    accessToken: tokenBody.access_token,
    refreshToken: tokenBody.refresh_token,
    scope: tokenBody.scope ?? '',
  };
}
