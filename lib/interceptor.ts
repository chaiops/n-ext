import { addRequest, type NetworkRequest } from "./store";

const MAX_BODY_SIZE = 64 * 1024;

const fpKey = Symbol.for("__nni_fingerprint__");
const g = globalThis as unknown as Record<symbol, string | undefined>;

export function setFingerprint(fp: string | undefined) {
  g[fpKey] = fp;
}

function getFingerprint(): string | undefined {
  return g[fpKey];
}

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
      if (size > MAX_BODY_SIZE) { reader.cancel(); break; }
    }
    const merged = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.length; }
    return new TextDecoder().decode(merged);
  } catch {
    return null;
  }
}

function extractRequestBody(_input: RequestInfo | URL, init?: RequestInit): string | null {
  const body = init?.body;
  if (!body) return null;
  if (typeof body === "string") return body.slice(0, MAX_BODY_SIZE);
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body).slice(0, MAX_BODY_SIZE);
  if (body instanceof URLSearchParams) return body.toString().slice(0, MAX_BODY_SIZE);
  return "[stream]";
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
    const fingerprint = getFingerprint();
    if (!fingerprint) return originalFetch(input, init);

    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    // Skip SSE endpoint to avoid recursion
    if (url.includes("/api/nni/")) return originalFetch(input, init);

    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const requestHeaders = headersToRecord(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    const requestBody = extractRequestBody(input, init);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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
    readBody(cloned.body).then((responseBody) => {
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
