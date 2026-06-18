// Fetch init extended with Next.js ISR hint; ignored by non-Next transports.
export interface TransportInit extends RequestInit {
  next?: { revalidate?: number };
  // Declared explicitly so the client type-checks against runtimes whose
  // RequestInit omits `cache` (React Native's fetch types do). Transports that
  // don't honor caching simply ignore it.
  cache?: "default" | "no-store" | "reload" | "no-cache" | "force-cache" | "only-if-cached";
}

// The minimal surface a transport must implement.
// Web (browser): uses /api/internal proxy, auth handled by Next middleware.
// Web (server): adds Authorization + X-User-Id directly.
// Mobile: adds Authorization: Bearer <access_token>, retries after refresh on 401.
export interface ApiTransport {
  readonly baseUrl: string;
  fetch(url: string, init: TransportInit): Promise<Response>;
}
