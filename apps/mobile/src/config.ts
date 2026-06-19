import Constants from 'expo-constants';

// Default port the local API listens on (apps/api, API_PORT).
const DEFAULT_API_PORT = 3001;

// Default port the local web app listens on (apps/web).
const DEFAULT_WEB_PORT = 3000;

// Metro dev-server host (the dev machine's LAN IP on a physical device), shared
// by the API and web URL resolvers. Undefined on web / when not in Expo Go.
function devHost(): string | undefined {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;
  return hostUri?.split(':')[0];
}

/**
 * Resolves the base URL the app talks to.
 *
 * Order:
 *  1. EXPO_PUBLIC_API_URL if set (use for a tunnel, staging, or production).
 *  2. Otherwise, in development, reuse the Metro dev-server host. On a physical
 *     phone in Expo Go that host is the dev machine's LAN IP the device is
 *     already connected to, so pointing the API at `http://<that-ip>:3001`
 *     works with zero manual configuration. (localhost would resolve to the
 *     phone itself, which is why we cannot use it on a real device.)
 *  3. Fall back to localhost (simulator / web).
 */
function resolveApiBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/+$/, '');

  const host = devHost();
  if (host) return `http://${host}:${DEFAULT_API_PORT}`;

  return `http://localhost:${DEFAULT_API_PORT}`;
}

/**
 * Resolves the web app URL. Gmail connection and email verification happen on
 * the web, so the app links out to it (the "connect Gmail on the web" hint and
 * the verify-email screen). Same host-resolution order as the API URL, on the
 * web port. Set EXPO_PUBLIC_WEB_URL for staging / production.
 */
function resolveWebAppUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_WEB_URL;
  if (explicit) return explicit.replace(/\/+$/, '');

  const host = devHost();
  if (host) return `http://${host}:${DEFAULT_WEB_PORT}`;

  return `http://localhost:${DEFAULT_WEB_PORT}`;
}

export const API_BASE_URL = resolveApiBaseUrl();
export const WEB_APP_URL = resolveWebAppUrl();
