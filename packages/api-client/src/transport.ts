// Fetch init extended with Next.js ISR hint; ignored by non-Next transports.
export interface TransportInit extends RequestInit {
  next?: { revalidate?: number };
}

// The minimal surface a transport must implement.
// Web (browser): uses /api/internal proxy, auth handled by Next middleware.
// Web (server): adds Authorization + X-User-Id directly.
// Mobile: adds Authorization: Bearer <access_token>, retries after refresh on 401.
export interface ApiTransport {
  readonly baseUrl: string;
  fetch(url: string, init: TransportInit): Promise<Response>;
}
