import { addRequest, type NetworkRequest } from "./store";
import { getConfig } from "./config";

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

async function readBody(body: ReadableStream<Uint8Array> | null, maxSize: number): Promise<string | null> {
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
      if (size > maxSize) { reader.cancel(); break; }
    }
    const merged = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.length; }
    return new TextDecoder().decode(merged);
  } catch (err) {
    console.debug("[NNI] Failed to read response body:", err);
    return null;
  }
}

function extractRequestBody(init: RequestInit | undefined, maxSize: number): string | null {
  const body = init?.body;
  if (!body) return null;
  if (typeof body === "string") return body.slice(0, maxSize);
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body).slice(0, maxSize);
  if (body instanceof URLSearchParams) return body.toString().slice(0, maxSize);
  return "[stream]";
}

let cookiesFn: (() => Promise<{ get(name: string): { value: string } | undefined }>) | null = null;

async function resolveFingerprint(cookieName: string): Promise<string | undefined> {
  if (!cookiesFn) {
    try {
      const mod = await import("next/headers");
      cookiesFn = mod.cookies;
    } catch {
      return undefined;
    }
  }

  try {
    const cookieStore = await cookiesFn!();
    return cookieStore.get(cookieName)?.value;
  } catch {
    // Expected outside request context (build time, module eval, telemetry fetches)
    return undefined;
  }
}

let installed = false;

export function installInterceptor() {
  if (installed) return;
  installed = true;

  const originalFetch = globalThis.fetch;

  globalThis.fetch = async function interceptedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const config = getConfig();
    const fingerprint = await resolveFingerprint(config.cookieName);
    if (!fingerprint) return originalFetch(input, init);

    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url.includes(config.apiPath)) return originalFetch(input, init);

    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const requestHeaders = headersToRecord(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    const requestBody = extractRequestBody(init, config.maxBodySize);
    const id = crypto.randomUUID();
    const start = performance.now();

    let response: Response;
    try {
      response = await originalFetch(input, init);
    } catch (err: unknown) {
      const doc: NetworkRequest = {
        id, url, method, requestHeaders, requestBody,
        status: null, statusText: null, responseHeaders: {}, responseBody: null,
        responseSize: null, duration: performance.now() - start,
        timestamp: Date.now(), error: err instanceof Error ? err.message : String(err),
      };
      addRequest(fingerprint, doc);
      throw err;
    }

    const duration = performance.now() - start;
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => { responseHeaders[k] = v; });

    const cloned = response.clone();
    readBody(cloned.body, config.maxBodySize).then((responseBody) => {
      const doc: NetworkRequest = {
        id, url, method, requestHeaders, requestBody,
        status: response.status, statusText: response.statusText,
        responseHeaders, responseBody, responseSize: responseBody?.length ?? null,
        duration, timestamp: Date.now(), error: null,
      };
      addRequest(fingerprint, doc);
    });

    return response;
  };

  console.log("[NNI] Network interceptor installed");
}
