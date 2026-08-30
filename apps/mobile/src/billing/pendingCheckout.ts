import * as SecureStore from 'expo-secure-store';

// Tracks a Stripe Checkout session the user was sent to the browser to complete.
// On return to the app we confirm it (POST /api/billing/confirm-checkout) so the
// upgrade lands immediately, without depending on the Stripe webhook. Persisted
// so it survives the app being backgrounded/killed during the browser detour.

const KEY = 'amarnai.billing.pendingCheckout';
// Drop stale entries so an abandoned checkout doesn't get retried forever.
const MAX_AGE_MS = 60 * 60 * 1000;

interface PendingCheckout {
  sessionId: string;
  ts: number;
}

export async function setPendingCheckout(sessionId: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify({ sessionId, ts: Date.now() }));
}

export async function clearPendingCheckout(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

export async function getPendingCheckout(): Promise<string | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingCheckout;
    if (!parsed.sessionId) return null;
    if (Date.now() - parsed.ts > MAX_AGE_MS) {
      await clearPendingCheckout();
      return null;
    }
    return parsed.sessionId;
  } catch {
    return null;
  }
}
