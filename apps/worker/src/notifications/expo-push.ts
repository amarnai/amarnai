// Expo Push transport. Sends already-built messages to the Expo Push API, which
// forwards them to FCM (Android) / APNs (iOS). The HTTP call is injected so the
// emit logic can be unit-tested without network access.
//
// Cost note (hosted plan): every message here is a billable FCM delivery. The
// caller is responsible for tenant scoping + per-user rate limiting before
// reaching this transport; see notify-threads.ts.

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

// Expo accepts at most 100 messages per request.
const EXPO_PUSH_CHUNK_SIZE = 100;

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  // Opaque payload delivered to the app (e.g. workspaceId + threadId for deep
  // linking on tap). Never include email bodies.
  data?: Record<string, unknown>;
  // Android notification category — maps to the inline-action set the app
  // registered under this id.
  categoryId?: string;
  channelId?: string;
}

export interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface SendExpoPushDeps {
  // Injected fetch implementation. Defaults to global fetch.
  fetch?: typeof fetch;
  endpoint?: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Sends push messages via Expo, batching into 100-message requests. Returns the
 * flattened tickets in input order. A failed batch (network/HTTP error) yields
 * synthetic error tickets for its messages rather than throwing, so one bad
 * batch never drops the others and the caller can act on per-message outcomes.
 */
export async function sendExpoPushMessages(
  messages: ExpoPushMessage[],
  deps: SendExpoPushDeps = {},
): Promise<ExpoPushTicket[]> {
  if (messages.length === 0) return [];

  const doFetch = deps.fetch ?? fetch;
  const endpoint = deps.endpoint ?? EXPO_PUSH_ENDPOINT;
  const tickets: ExpoPushTicket[] = [];

  for (const batch of chunk(messages, EXPO_PUSH_CHUNK_SIZE)) {
    try {
      const res = await doFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(batch),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error(`[expo-push] Expo returned ${res.status}: ${text.slice(0, 200)}`);
        for (let i = 0; i < batch.length; i++) {
          tickets.push({ status: "error", message: `HTTP ${res.status}` });
        }
        continue;
      }

      const json = (await res.json()) as { data?: ExpoPushTicket[] };
      const batchTickets = Array.isArray(json.data) ? json.data : [];
      // Expo returns one ticket per message in order; pad if it returned fewer.
      for (let i = 0; i < batch.length; i++) {
        tickets.push(batchTickets[i] ?? { status: "error", message: "No ticket returned" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[expo-push] Send failed: ${msg}`);
      for (let i = 0; i < batch.length; i++) {
        tickets.push({ status: "error", message: msg });
      }
    }
  }

  return tickets;
}
