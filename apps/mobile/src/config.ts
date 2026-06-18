import Constants from 'expo-constants';

// Default port the local API listens on (apps/api, API_PORT).
const DEFAULT_API_PORT = 3001;

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

  // hostUri looks like "192.168.1.23:8081"; debuggerHost is the older field.
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;
  const host = hostUri?.split(':')[0];
  if (host) return `http://${host}:${DEFAULT_API_PORT}`;

  return `http://localhost:${DEFAULT_API_PORT}`;
}

export const API_BASE_URL = resolveApiBaseUrl();
