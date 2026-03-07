import type { NExtEvent } from "../shared/event-types";

const http = require("node:http") as typeof import("node:http");
// Save original before interceptors patch it
const originalHttpRequest = http.request.bind(http);

const STORE_KEY = Symbol.for("__n_ext_store__");
const MAX_EVENTS = 1000;

interface Store {
  events: NExtEvent[];
  cursor: number;
  remote: boolean;
}

function getStore(): Store {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = { events: [], cursor: 0, remote: false };
  }
  return g[STORE_KEY]!;
}

export function setRemoteMode() {
  getStore().remote = true;
}

function sendToServer(event: Omit<NExtEvent, "cursor">) {
  const data = JSON.stringify(event);
  const req = originalHttpRequest({
    hostname: "127.0.0.1",
    port: 3894,
    path: "/ingest",
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
  });
  req.on("error", () => {}); // silently ignore
  req.end(data);
}

export function addEvent(event: Omit<NExtEvent, "cursor">): NExtEvent {
  const store = getStore();

  if (store.remote) {
    sendToServer(event);
    return { ...event, cursor: 0 };
  }

  store.cursor++;
  const stored: NExtEvent = { ...event, cursor: store.cursor };
  store.events.push(stored);
  if (store.events.length > MAX_EVENTS) {
    store.events.shift();
  }
  return stored;
}

export function clearEvents(): number {
  const store = getStore();
  store.events = [];
  return store.cursor;
}

export function getEvents(afterCursor: number = 0): { cursor: number; events: NExtEvent[] } {
  const store = getStore();
  const events = afterCursor > 0
    ? store.events.filter((e) => e.cursor > afterCursor)
    : store.events;
  return { cursor: store.cursor, events };
}
