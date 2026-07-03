import { vi } from "vitest";

// Minimal in-memory chrome.* stub so modules that touch chrome APIs load and
// behave deterministically under jsdom. Individual tests can override members.
const store = new Map<string, unknown>();

const chromeStub = {
  storage: {
    local: {
      get: vi.fn(async (key: string) => {
        return key in store || store.has(key) ? { [key]: store.get(key) } : {};
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) store.set(k, v);
      }),
      remove: vi.fn(async (key: string) => {
        store.delete(key);
      }),
    },
  },
  identity: {
    getRedirectURL: vi.fn(() => "https://abcdefghijklmnop.chromiumapp.org/"),
    launchWebAuthFlow: vi.fn(),
  },
  tabs: {
    query: vi.fn(async () => []),
    update: vi.fn(async () => {}),
    create: vi.fn(async () => {}),
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

// Reset the backing store between tests without dropping the stub.
export function resetChromeStorage(): void {
  store.clear();
}
