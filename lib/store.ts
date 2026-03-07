export interface NetworkRequest {
  id: string;
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  status: number | null;
  statusText: string | null;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
  responseSize: number | null;
  duration: number;
  timestamp: number;
  error: string | null;
}

const MAX_REQUESTS = 50;
const TTL_MS = 60 * 60 * 1000;

interface FingerprintStore {
  requests: NetworkRequest[];
  listeners: Set<(req: NetworkRequest) => void>;
  timer: ReturnType<typeof setTimeout>;
}

const globalKey = Symbol.for("__nni_stores__");
const g = globalThis as unknown as Record<symbol, Map<string, FingerprintStore>>;
if (!g[globalKey]) g[globalKey] = new Map();
const stores = g[globalKey];

function resetTTL(fingerprint: string) {
  const store = stores.get(fingerprint);
  if (!store) return;
  clearTimeout(store.timer);
  store.timer = setTimeout(() => {
    store.listeners.clear();
    stores.delete(fingerprint);
  }, TTL_MS);
}

function getStore(fingerprint: string): FingerprintStore {
  const existing = stores.get(fingerprint);
  if (existing) {
    resetTTL(fingerprint);
    return existing;
  }

  const store: FingerprintStore = {
    requests: [],
    listeners: new Set(),
    timer: setTimeout(() => {
      store.listeners.clear();
      stores.delete(fingerprint);
    }, TTL_MS),
  };
  stores.set(fingerprint, store);
  return store;
}

export function addRequest(fingerprint: string, req: NetworkRequest) {
  const store = getStore(fingerprint);
  store.requests.push(req);
  if (store.requests.length > MAX_REQUESTS) {
    store.requests.shift();
  }
  for (const listener of store.listeners) {
    listener(req);
  }
}

export function subscribe(
  fingerprint: string,
  listener: (req: NetworkRequest) => void
): () => void {
  const store = getStore(fingerprint);
  store.listeners.add(listener);
  return () => store.listeners.delete(listener);
}

export function getRequests(fingerprint: string): NetworkRequest[] {
  return getStore(fingerprint).requests;
}
