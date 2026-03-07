import { addEvent } from "./event-store";
import { SEE_HOST, SEE_PORT, MAX_BODY } from "../shared/constants";

// Use require to get the mutable CJS module objects (ESM imports give frozen namespace)
const http = require("node:http") as typeof import("node:http");
const https = require("node:https") as typeof import("node:https");

function isSelfRequest(options: http.RequestOptions | string | URL): boolean {
  if (typeof options === "string" || options instanceof URL) {
    try {
      const u = new URL(typeof options === "string" ? options : options.href);
      return u.hostname === SEE_HOST && Number(u.port) === SEE_PORT;
    } catch {
      return false;
    }
  }
  return options.hostname === SEE_HOST && Number(options.port) === SEE_PORT;
}

function extractUrl(options: http.RequestOptions | string | URL, protocol: string): string {
  if (typeof options === "string") return options;
  if (options instanceof URL) return options.href;
  const host = options.hostname || options.host || "localhost";
  const port = options.port ? `:${options.port}` : "";
  const path = options.path || "/";
  return `${protocol}//${host}${port}${path}`;
}

function headersToRecord(raw: http.OutgoingHttpHeaders | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw) return result;
  for (const [k, v] of Object.entries(raw)) {
    if (v != null) result[k] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return result;
}

function patchModule(mod: typeof http | typeof https, protocol: string) {
  const originalRequest = mod.request;
  const originalGet = mod.get;

  function interceptRequest(
    this: unknown,
    ...args: Parameters<typeof http.request>
  ): http.ClientRequest {
    const [urlOrOpts, optsOrCb, maybeCb] = args;

    if (isSelfRequest(urlOrOpts)) {
      return originalRequest.apply(mod, args as any);
    }

    const url = extractUrl(urlOrOpts, protocol);
    const options: http.RequestOptions =
      typeof urlOrOpts === "string" || urlOrOpts instanceof URL
        ? (typeof optsOrCb === "object" ? optsOrCb : {})
        : urlOrOpts;

    const method = (options.method || "GET").toUpperCase();
    const requestHeaders = headersToRecord(options.headers);
    const id = crypto.randomUUID();
    const start = performance.now();
    const requestChunks: Buffer[] = [];
    let requestSize = 0;

    const req = originalRequest.apply(mod, args as any) as http.ClientRequest;

    const origWrite = req.write.bind(req);
    req.write = function (chunk: any, ...rest: any[]): boolean {
      if (chunk && requestSize < MAX_BODY) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        requestChunks.push(buf);
        requestSize += buf.length;
      }
      return origWrite(chunk, ...rest);
    } as any;

    req.on("response", (res: http.IncomingMessage) => {
      const responseChunks: Buffer[] = [];
      let responseSize = 0;

      res.on("data", (chunk: Buffer) => {
        responseSize += chunk.length;
        if (responseSize <= MAX_BODY) {
          responseChunks.push(chunk);
        }
      });

      res.on("end", () => {
        const responseHeaders = headersToRecord(res.headers as http.OutgoingHttpHeaders);

        const responseBody = Buffer.concat(responseChunks).toString("utf-8").slice(0, MAX_BODY);
        const requestBody = requestChunks.length > 0
          ? Buffer.concat(requestChunks).toString("utf-8").slice(0, MAX_BODY)
          : null;

        addEvent({
          id, url, method, requestHeaders, requestBody,
          status: res.statusCode ?? null,
          statusText: res.statusMessage ?? null,
          responseHeaders, responseBody,
          responseSize,
          duration: performance.now() - start,
          timestamp: Date.now(),
          error: null,
          source: "http",
        });
      });
    });

    req.on("error", (err: Error) => {
      const requestBody = requestChunks.length > 0
        ? Buffer.concat(requestChunks).toString("utf-8").slice(0, MAX_BODY)
        : null;

      addEvent({
        id, url, method, requestHeaders, requestBody,
        status: null, statusText: null,
        responseHeaders: {}, responseBody: null, responseSize: null,
        duration: performance.now() - start,
        timestamp: Date.now(),
        error: err.message,
        source: "http",
      });
    });

    return req;
  }

  (mod as any).request = interceptRequest;

  (mod as any).get = function (this: unknown, ...args: Parameters<typeof http.get>): http.ClientRequest {
    const req = (mod.request as any)(...args);
    req.end();
    return req;
  };
}

let installed = false;

export function installHttpInterceptor() {
  if (installed) return;
  installed = true;
  patchModule(http, "http:");
  patchModule(https, "https:");
}
