import type { NExtEvent } from "../shared/event-types";
import { SEE_HOST, SEE_PORT, MAX_EVENTS } from "../shared/constants";

const http = require("node:http") as typeof import("node:http");
// Save original before interceptors patch it
const originalHttpRequest = http.request.bind(http);

const STORE_KEY = Symbol.for("__n_ext_store__");

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
    hostname: SEE_HOST,
    port: SEE_PORT,
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
  let events: NExtEvent[];
  if (afterCursor > 0) {
    // Cursors are monotonically increasing — find start index with binary search
    let lo = 0, hi = store.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (store.events[mid].cursor <= afterCursor) lo = mid + 1;
      else hi = mid;
    }
    events = store.events.slice(lo);
  } else {
    events = store.events;
  }
  return { cursor: store.cursor, events };
}
