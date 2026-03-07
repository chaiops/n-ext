import { addEvent } from "./event-store";
import type { NExtEvent } from "../shared/event-types";

const SEE_HOST = "127.0.0.1:3894";
const MAX_BODY = 64 * 1024;

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  if (headers instanceof Headers) {
    headers.forEach((v, k) => { result[k] = v; });
  } else if (Array.isArray(headers)) {
    for (const [k, v] of headers) result[k] = v;
  } else {
    Object.assign(result, headers);
  }
  return result;
}

function extractRequestBody(init: RequestInit | undefined): string | null {
  const body = init?.body;
  if (!body) return null;
  if (typeof body === "string") return body.slice(0, MAX_BODY);
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body).slice(0, MAX_BODY);
  if (body instanceof URLSearchParams) return body.toString().slice(0, MAX_BODY);
  return "[stream]";
}

async function readBody(body: ReadableStream<Uint8Array> | null): Promise<string | null> {
  if (!body) return null;
  try {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
      if (size > MAX_BODY) { reader.cancel(); break; }
    }
    const merged = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.length; }
    return new TextDecoder().decode(merged);
  } catch {
    return null;
  }
}

let installed = false;

export function installFetchInterceptor() {
  if (installed) return;
  installed = true;

  const originalFetch = globalThis.fetch;

  globalThis.fetch = async function interceptedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url.includes(SEE_HOST)) return originalFetch(input, init);

    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const requestHeaders = headersToRecord(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    const requestBody = extractRequestBody(init);
    const id = crypto.randomUUID();
    const start = performance.now();

    let response: Response;
    try {
      response = await originalFetch(input, init);
    } catch (err: unknown) {
      addEvent({
        id, url, method, requestHeaders, requestBody,
        status: null, statusText: null, responseHeaders: {}, responseBody: null,
        responseSize: null, duration: performance.now() - start,
        timestamp: Date.now(), error: err instanceof Error ? err.message : String(err),
        source: "fetch",
      });
      throw err;
    }

    const duration = performance.now() - start;
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => { responseHeaders[k] = v; });

    const cloned = response.clone();
    readBody(cloned.body).then((responseBody) => {
      addEvent({
        id, url, method, requestHeaders, requestBody,
        status: response.status, statusText: response.statusText,
        responseHeaders, responseBody, responseSize: responseBody?.length ?? null,
        duration, timestamp: Date.now(), error: null,
        source: "fetch",
      });
    });

    return response;
  };
}
