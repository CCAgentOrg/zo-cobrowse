// Shared Chrome Extension API mock for Zo Co-browse tests
// All test files import from here instead of duplicating mocks.

// Recorded chrome.tabs.create calls of the current mock (url + active flag).
export let tabsCreateCalls: Array<{ url?: string; active?: boolean }> = [];

export function resetTabsCreateCalls() {
  tabsCreateCalls = [];
}

const mockStorageArea = () => {
  let store: Record<string, any> = {};
  const mock: any = {
    get: (keys: string | string[] | Record<string, any> | null, cb?: Function) => {
      if (typeof keys === "function") { cb = keys; keys = null; }
      if (keys === null) {
        if (cb) cb({ ...store });
      } else if (typeof keys === "string") {
        if (cb) cb({ [keys]: store[keys] ?? undefined });
      } else if (Array.isArray(keys)) {
        const result: Record<string, any> = {};
        for (const k of keys) result[k] = store[k] ?? undefined;
        if (cb) cb(result);
      } else {
        const result: Record<string, any> = {};
        for (const k of Object.keys(keys)) result[k] = store[k] ?? keys[k];
        if (cb) cb(result);
      }
      return Promise.resolve({ ...store });
    },
    set: (items: Record<string, any>, cb?: Function) => {
      Object.assign(store, items);
      if (cb) cb();
      return Promise.resolve();
    },
    remove: (keys: string | string[], cb?: Function) => {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) delete store[k];
      if (cb) cb();
      return Promise.resolve();
    },
    clear: (cb?: Function) => { store = {}; if (cb) cb(); return Promise.resolve(); },
    getBytesInUse: (_keys: any, cb?: Function) => { if (cb) cb(0); return Promise.resolve(0); },
  };
  return mock;
};

// Shared mock — each test gets a fresh copy via beforeEach
export function createMockChrome(): any {
  const mock = {
    runtime: {
      id: "test-extension-id",
      lastError: undefined,
      onMessage: { addListener: () => {} },
      onConnect: { addListener: () => {} },
      sendMessage: () => Promise.resolve(),
      connect: () => ({
        onMessage: { addListener: () => {} },
        onDisconnect: { addListener: () => {} },
        postMessage: () => {},
      }),
    },
    storage: {
      sync: mockStorageArea(),
      local: mockStorageArea(),
      managed: mockStorageArea(),
      session: mockStorageArea(),
    },
    tabs: {
      query: () => Promise.resolve([]),
      sendMessage: () => Promise.resolve(),
      captureVisibleTab: () => Promise.resolve("data:image/jpeg;base64,/9j/test=="),
      // Records calls (open-all tests assert the url + active flags) and
      // resolves with a distinct synthetic tab id per call.
      create: (props: any = {}) => {
        tabsCreateCalls.push({ ...props });
        return Promise.resolve({ id: 9001 + tabsCreateCalls.length });
      },
    },
    action: {
      onClicked: { addListener: () => {} },
      setBadgeText: () => {},
      setBadgeBackgroundColor: () => {},
      setIcon: () => {},
    },
    sidePanel: {
      open: () => Promise.resolve(),
      setOptions: () => Promise.resolve(),
    },
    contextMenus: {
      create: () => {},
      removeAll: (cb?: Function) => { if (cb) cb(); },
      onClicked: { addListener: () => {} },
    },
    scripting: {
      executeScript: () => Promise.resolve([]),
      insertCSS: () => Promise.resolve(),
    },
    commands: {
      getAll: (cb?: Function) => { if (cb) cb([]); return Promise.resolve([]); },
      onCommand: { addListener: () => {} },
    },
    i18n: {
      getMessage: () => "",
      getUILanguage: () => "en",
    },
    permissions: {
      contains: () => Promise.resolve(false),
      request: () => Promise.resolve(true),
    },
  };
  return mock;
}

// Use in test files: assign to global chrome in beforeEach, delete in afterEach
export function installChromeMock(global: any, mock: any) {
  global.chrome = mock;
}

export function uninstallChromeMock(global: any) {
  delete global.chrome;
}
