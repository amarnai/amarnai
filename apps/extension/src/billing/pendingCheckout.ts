import { ext } from "../platform/ext";

// Tracks a Stripe Checkout session the user was sent to a tab to complete. When
// the panel regains focus we confirm it (POST /api/billing/confirm-checkout) so
// the upgrade lands immediately rather than waiting on the Stripe webhook.
// Persisted in storage.local because the panel is destroyed when closed, so
// in-memory state would not survive the detour.

const KEY = "amarnai.billing.pendingCheckout";
// Drop stale entries so an abandoned checkout is not retried forever.
const MAX_AGE_MS = 60 * 60 * 1000;

interface PendingCheckout {
  sessionId: string;
  ts: number;
}

export async function setPendingCheckout(sessionId: string): Promise<void> {
  await ext.storage.local.set({ [KEY]: JSON.stringify({ sessionId, ts: Date.now() }) });
}

export async function clearPendingCheckout(): Promise<void> {
  await ext.storage.local.remove(KEY);
}

export async function getPendingCheckout(): Promise<string | null> {
  const out = await ext.storage.local.get(KEY);
  const raw = out[KEY] as string | undefined;
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
