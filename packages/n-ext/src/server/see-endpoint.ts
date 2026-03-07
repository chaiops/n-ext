const http = require("node:http") as typeof import("node:http");
import { addEvent, getEvents, clearEvents } from "../runtime/event-store";
import { SEE_HOST as HOST, SEE_PORT as PORT } from "../shared/constants";

export function startSeeServer(): Promise<boolean> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

      if (url.pathname === "/see" && req.method === "GET") {
        const cursorParam = url.searchParams.get("cursor");
        const afterCursor = cursorParam ? parseInt(cursorParam, 10) : 0;
        const result = getEvents(isNaN(afterCursor) ? 0 : afterCursor);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
      }

      if (url.pathname === "/ingest" && req.method === "POST") {
        let body = "";
        let bodySize = 0;
        const MAX_INGEST = 256 * 1024;
        req.on("data", (chunk: Buffer) => {
          bodySize += chunk.length;
          if (bodySize > MAX_INGEST) { req.destroy(); return; }
          body += chunk;
        });
        req.on("end", () => {
          try {
            const event = JSON.parse(body);
            addEvent(event);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON" }));
          }
        });
        return;
      }

      if (url.pathname === "/clear" && req.method === "POST") {
        const newCursor = clearEvents();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, cursor: newCursor }));
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found. Use GET /see" }));
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve(false);
        return;
      }
      console.error("[n-ext] Server error:", err);
      resolve(false);
    });

    server.listen(PORT, HOST, () => {
      console.log(`[n-ext] DevTools server running at http://${HOST}:${PORT}/see`);
      resolve(true);
    });
  });
}
