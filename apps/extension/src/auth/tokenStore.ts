import type { StoredTokens, TokenStore } from "@amarnai/api-client";

export type { StoredTokens, TokenStore };

const KEY = "amarnai.auth.tokens";

// Tokens live in chrome.storage.local — scoped to the extension, persists across
// panel open/close and service-worker death (the panel is destroyed when closed,
// so in-memory state cannot be relied on). The whole pair is stored under one
// key as JSON, mirroring the mobile secure-store shape.
export const extensionTokenStore: TokenStore = {
  async get() {
    const out = await chrome.storage.local.get(KEY);
    const raw = out[KEY] as string | undefined;
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as StoredTokens;
      if (!parsed.accessToken || !parsed.refreshToken) return null;
      return parsed;
    } catch {
      return null;
    }
  },
  async set(tokens) {
    await chrome.storage.local.set({ [KEY]: JSON.stringify(tokens) });
  },
  async clear() {
    await chrome.storage.local.remove(KEY);
  },
};
