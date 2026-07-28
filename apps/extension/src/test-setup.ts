import { vi } from "vitest";

// Minimal in-memory chrome.* stub so modules that touch chrome APIs load and
// behave deterministically under jsdom. Individual tests can override members.
const store = new Map<string, unknown>();
const sessionStore = new Map<string, unknown>();

function areaStub(backing: Map<string, unknown>) {
  return {
    get: vi.fn(async (key: string) => (backing.has(key) ? { [key]: backing.get(key) } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) backing.set(k, v);
    }),
    remove: vi.fn(async (key: string) => {
      backing.delete(key);
    }),
  };
}

const chromeStub = {
  storage: {
    local: areaStub(store),
    // storage.session backs the content-script → background workspace cache.
    session: areaStub(sessionStore),
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  runtime: {
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    onInstalled: { addListener: vi.fn() },
    sendMessage: vi.fn(async () => undefined),
    getManifest: vi.fn(() => ({ version: "0.0.0-test" })),
    getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
  },
  identity: {
    getRedirectURL: vi.fn(() => "https://abcdefghijklmnop.chromiumapp.org/"),
    launchWebAuthFlow: vi.fn(),
  },
  tabs: {
    query: vi.fn(async () => []),
    update: vi.fn(async () => ({}) as chrome.tabs.Tab),
    create: vi.fn(async () => ({}) as chrome.tabs.Tab),
  },
  sidePanel: {
    setPanelBehavior: vi.fn(async () => {}),
    setOptions: vi.fn(async () => {}),
  },
  action: {
    onClicked: { addListener: vi.fn() },
  },
  permissions: {
    request: vi.fn(async () => true),
    contains: vi.fn(async () => true),
  },
} as unknown as typeof chrome;

globalThis.chrome = chromeStub;

// Reset the backing stores between tests without dropping the stub.
export function resetChromeStorage(): void {
  store.clear();
  sessionStore.clear();
}
