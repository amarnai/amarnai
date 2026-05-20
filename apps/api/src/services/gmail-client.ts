import { decrypt } from "./encryption.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const GMAIL_THREADS_URL = "https://gmail.googleapis.com/gmail/v1/users/me/threads";

type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

export type GmailProfile = {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
};

export class GmailClient {
  constructor(private readonly encryptedRefreshToken: string) {}

  async refreshAccessToken(): Promise<string> {
    const refreshToken = decrypt(this.encryptedRefreshToken);
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: process.env["AUTH_GOOGLE_ID"] ?? "",
        client_secret: process.env["AUTH_GOOGLE_SECRET"] ?? "",
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
    const data = (await res.json()) as TokenResponse;
    return data.access_token;
  }

  async getProfile(): Promise<GmailProfile> {
    const accessToken = await this.refreshAccessToken();
    const res = await fetch(GMAIL_PROFILE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Gmail profile fetch failed: ${res.status}`);
    return res.json() as Promise<GmailProfile>;
  }

  async listRecentThreadIds(maxResults = 10): Promise<string[]> {
    const accessToken = await this.refreshAccessToken();
    const params = new URLSearchParams({ maxResults: String(maxResults) });
    const res = await fetch(`${GMAIL_THREADS_URL}?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Gmail threads list failed: ${res.status}`);
    type ThreadList = { threads?: Array<{ id: string }> };
    const data = (await res.json()) as ThreadList;
    return (data.threads ?? []).map((t) => t.id);
  }
}
