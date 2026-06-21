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
 * Resolves the web app URL. Gmail connection, email verification, and billing
 * happen on the web, so the app links/fetches out to it.
 *
 * Order:
 *  1. EXPO_PUBLIC_WEB_URL if set (use for a tunnel, staging, or production where
 *     the web app lives on a different host than the API).
 *  2. Reuse the host pinned in EXPO_PUBLIC_API_URL on the web port. The API and
 *     web dev servers run on the same machine, so a single `EXPO_PUBLIC_API_URL=
 *     http://<lan-ip>:3001` makes both reachable from a physical device with no
 *     second variable. Only applied when that URL is an explicit host:port.
 *  3. Fall back to the Metro dev-server host, then localhost.
 */
function resolveWebAppUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_WEB_URL;
  if (explicit) return explicit.replace(/\/+$/, '');

  const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');
  const apiHostPort = apiUrl?.match(/^(https?:\/\/[^/:]+):\d+$/);
  if (apiHostPort) return `${apiHostPort[1]}:${DEFAULT_WEB_PORT}`;

  const host = devHost();
  if (host) return `http://${host}:${DEFAULT_WEB_PORT}`;

  return `http://localhost:${DEFAULT_WEB_PORT}`;
}

export const API_BASE_URL = resolveApiBaseUrl();
export const WEB_APP_URL = resolveWebAppUrl();
