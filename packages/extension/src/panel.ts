import renderjson from "renderjson";

renderjson.set_show_to_level(1);
renderjson.set_icons("▶ ", "▼ ");
renderjson.set_sort_objects(true);

interface NExtEvent {
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
  source: "fetch" | "http" | "action";
  actionId?: string;
  middleware?: boolean;
  middlewareHeaders?: Record<string, string>;
}

const MAX_PANEL_EVENTS = 200;

let allRequests: NExtEvent[] = [];
let selectedRequest: NExtEvent | null = null;
let activeTab = "headers";
let activeMethod = "all";
let cursor = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

const SEE_URL = "http://127.0.0.1:3894/see";
const CLEAR_URL = "http://127.0.0.1:3894/clear";

function addRequest(event: NExtEvent): void {
  allRequests.unshift(event);
  if (allRequests.length > MAX_PANEL_EVENTS) allRequests.pop();
}

function getActionName(url: string): string {
  return shortenUrl(url).replace(
    /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/[id]"
  );
}

interface RscChunk {
  id: string;
  type: string | null;
  data: unknown;
}

function parseRscPayload(raw: string): RscChunk[] {
  const chunks: RscChunk[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim() || line.startsWith(":")) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const id = line.slice(0, colonIdx);
    const rest = line.slice(colonIdx + 1);
    let type: string | null = null;
    let json = rest;
    if (rest.length > 0 && rest[0] >= "A" && rest[0] <= "Z") {
      type = rest[0];
      json = rest.slice(1);
    }
    let data: unknown = json;
    try { data = JSON.parse(json); } catch { /* keep as string */ }
    chunks.push({ id, type, data });
  }
  return chunks;
}

function resolveRscData(chunks: RscChunk[]): unknown | null {
  // Find the main data chunk (non-debug, non-header, with object data)
  for (const chunk of chunks) {
    if (chunk.type === "D") continue; // skip debug/timing
    if (typeof chunk.data === "object" && chunk.data !== null) {
      const obj = chunk.data as Record<string, unknown>;
      // Prefer chunks that have "data" or look like actual payloads
      if ("data" in obj || "error" in obj) return obj;
    }
  }
  // Fallback: return last non-debug chunk with object data
  for (let i = chunks.length - 1; i >= 0; i--) {
    if (chunks[i].type !== "D" && typeof chunks[i].data === "object") {
      return chunks[i].data;
    }
  }
  return null;
}

const MIDDLEWARE_HEADERS = ["x-middleware-rewrite", "x-middleware-next", "x-middleware-set-cookie", "x-middleware-redirect"];

function harHeadersToRecord(headers: { name: string; value: string }[]): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((h) => { result[h.name] = h.value; });
  return result;
}

function detectMiddleware(resHeaders: Record<string, string>): { hit: boolean; headers: Record<string, string> } {
  const mwHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(resHeaders)) {
    if (MIDDLEWARE_HEADERS.includes(k.toLowerCase())) {
      mwHeaders[k] = v;
    }
  }
  return { hit: Object.keys(mwHeaders).length > 0, headers: mwHeaders };
}

// Capture Next.js Server Actions + middleware detection from browser network
if (typeof chrome !== "undefined" && chrome.devtools?.network) {
  chrome.devtools.network.onRequestFinished.addListener((entry) => {
    const nextActionHeader = entry.request.headers.find(
      (h) => h.name.toLowerCase() === "next-action"
    );
    const resHeaders = harHeadersToRecord(entry.response.headers);
    const mw = detectMiddleware(resHeaders);

    // Only capture server actions and middleware requests
    if (!nextActionHeader && !mw.hit) return;

    entry.getContent((body) => {
      const reqHeaders = harHeadersToRecord(entry.request.headers);

      const event: NExtEvent = {
        id: crypto.randomUUID(),
        url: entry.request.url,
        method: entry.request.method,
        requestHeaders: reqHeaders,
        requestBody: entry.request.postData?.text || null,
        status: entry.response.status,
        statusText: entry.response.statusText,
        responseHeaders: resHeaders,
        responseBody: body || null,
        responseSize: body?.length ?? null,
        duration: entry.time || 0,
        timestamp: Date.now(),
        error: null,
        source: nextActionHeader ? "action" : "fetch",
        actionId: nextActionHeader?.value,
        middleware: mw.hit,
        middlewareHeaders: mw.hit ? mw.headers : undefined,
      };

      addRequest(event);
      applyFilters();
    });
  });
}

function setStatus(connected: boolean): void {
  const el = document.getElementById("statusIndicator")!;
  el.textContent = connected ? "🟢 Connected" : "🔴 Disconnected";
  el.className = "status " + (connected ? "connected" : "disconnected");
}

function resetToHeadersTab(): void {
  activeTab = "headers";
  document.querySelectorAll(".detail-tabs button").forEach((b) => b.classList.remove("active"));
  document.querySelector('.detail-tabs button[data-tab="headers"]')?.classList.add("active");
}

function closeDetail(): void {
  selectedRequest = null;
  document.getElementById("detailPanel")!.classList.remove("open");
  document.getElementById("resizeHandle")!.classList.remove("visible");
  document.querySelectorAll("tr.row").forEach((row) => row.classList.remove("selected"));
}

async function poll(): Promise<void> {
  try {
    const url = cursor > 0 ? `${SEE_URL}?cursor=${cursor}` : SEE_URL;
    const res = await fetch(url);
    if (!res.ok) {
      setStatus(false);
      return;
    }
    const data = await res.json();
    cursor = data.cursor;

    if (data.events.length > 0) {
      for (const event of data.events) {
        // Detect middleware from response headers on server-side events
        if (event.responseHeaders) {
          const mw = detectMiddleware(event.responseHeaders);
          if (mw.hit) {
            event.middleware = true;
            event.middlewareHeaders = mw.headers;
          }
        }
        addRequest(event);
      }
      applyFilters();
    }

    setStatus(true);
  } catch {
    setStatus("disconnected", false);
  }
}

function startPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  poll();
  pollTimer = setInterval(poll, 500);
}

function applyFilters(): void {
  const filter = (document.getElementById("filterInput") as HTMLInputElement).value.toLowerCase();
  let filtered = allRequests;

  if (filter) {
    filtered = filtered.filter((r) => r.url && r.url.toLowerCase().includes(filter));
  }

  if (activeMethod === "ACTION") {
    filtered = filtered.filter((r) => r.source === "action");
  } else if (activeMethod !== "all") {
    filtered = filtered.filter((r) => r.method === activeMethod);
  }

  renderRequests(filtered);
}

function renderRequests(requests: NExtEvent[]): void {
  const tbody = document.getElementById("requestBody")!;
  const empty = document.getElementById("emptyState") as HTMLElement;

  if (requests.length === 0) {
    tbody.innerHTML = "";
    empty.style.display = "flex";
    return;
  }

  empty.style.display = "none";

  tbody.innerHTML = requests
    .map((req) => {
      const statusClass = getStatusClass(req.status);
      const methodClass = "method-" + (req.method || "get").toLowerCase();
      const selected = selectedRequest && selectedRequest.id === req.id ? " selected" : "";
      const size = req.responseSize != null ? formatSize(req.responseSize) : "-";
      const duration = req.duration != null ? Math.round(req.duration) + "ms" : "-";
      const time = req.timestamp ? formatTime(req.timestamp) : "-";
      const shortUrl = req.url ? shortenUrl(req.url) : "-";
      const source = req.source ? `<span class="source-badge${req.source === "action" ? " action" : ""}">${req.source}</span>` : "";
      const mwBadge = req.middleware ? `<span class="source-badge middleware">mw</span>` : "";
      return `<tr class="row${selected}" data-id="${escapeHtml(req.id)}">
        <td class="${methodClass}">${req.method || "-"}</td>
        <td title="${escapeHtml(req.url || "")}">${escapeHtml(shortUrl)} ${source}${mwBadge}</td>
        <td class="${statusClass}">${req.error ? "ERR" : req.status || "-"}</td>
        <td>${duration}</td>
        <td>${size}</td>
        <td>${time}</td>
      </tr>`;
    })
    .join("");
}

function selectRequest(id: string): void {
  selectedRequest = allRequests.find((r) => r.id === id) || null;
  const panel = document.getElementById("detailPanel")!;

  if (selectedRequest) {
    panel.classList.add("open");
    document.getElementById("resizeHandle")!.classList.add("visible");
    const authTab = document.getElementById("authTab") as HTMLElement;
    if (authTab) authTab.style.display = hasBearerToken(selectedRequest) ? "" : "none";
    const actionTab = document.getElementById("actionTab") as HTMLElement;
    if (actionTab) actionTab.style.display = selectedRequest.source === "action" ? "" : "none";
    if (activeTab === "action" && selectedRequest.source !== "action") resetToHeadersTab();
    if (activeTab === "auth" && !hasBearerToken(selectedRequest)) resetToHeadersTab();
    renderDetail();
  } else {
    closeDetail();
  }

  document.querySelectorAll("tr.row").forEach((row) => {
    (row as HTMLElement).classList.toggle("selected", (row as HTMLElement).dataset.id === id);
  });
}

function showTab(tab: string, btn: HTMLElement): void {
  activeTab = tab;
  document.querySelectorAll(".detail-tabs button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  renderDetail();
}

function renderDetail(): void {
  const content = document.getElementById("detailContent")!;
  if (!selectedRequest) return;

  const req = selectedRequest;

  switch (activeTab) {
    case "headers":
      content.innerHTML = `
        <div class="detail-section">
          <div class="section-header"><h3>General</h3><button class="copy-btn" id="copyCurlBtn" title="Copy as cURL">⚙️ Copy as cURL</button></div>
          <div class="header-row"><span class="header-name">URL</span><span class="header-value">${escapeHtml(req.url || "")}</span></div>
          <div class="header-row"><span class="header-name">Method</span><span class="header-value">${req.method || "-"}</span></div>
          <div class="header-row"><span class="header-name">Status</span><span class="header-value">${req.error ? "Error: " + escapeHtml(req.error) : (req.status || "-") + " " + (req.statusText || "")}</span></div>
          <div class="header-row"><span class="header-name">Duration</span><span class="header-value">${req.duration != null ? req.duration.toFixed(1) + "ms" : "-"}</span></div>
          <div class="header-row"><span class="header-name">Source</span><span class="header-value">${req.source || "-"}</span></div>
          ${req.middleware ? `<div class="header-row"><span class="header-name">Middleware</span><span class="header-value"><span class="source-badge middleware">yes</span></span></div>` : ""}
        </div>
        ${req.middleware && req.middlewareHeaders ? `<div class="detail-section">
          <h3>Middleware Headers</h3>
          ${renderHeaders(req.middlewareHeaders)}
        </div>` : ""}
        <div class="detail-section">
          <h3>Request Headers</h3>
          ${renderHeaders(req.requestHeaders)}
        </div>
        <div class="detail-section">
          <h3>Response Headers</h3>
          ${renderHeaders(req.responseHeaders)}
        </div>`;
      document.getElementById("copyCurlBtn")!.addEventListener("click", () => {
        const btn = document.getElementById("copyCurlBtn")!;
        copyTextToClipboard(toCurl(req), btn, "⚙️ Copy as cURL");
      });
      break;

    case "request":
      content.innerHTML = `
        <div class="detail-section">
          <div class="section-header"><h3>Request Body</h3><button class="copy-btn" id="copyBodyBtn" title="Copy to clipboard">📋 Copy</button></div>
          <div class="body-preview" id="bodyPreview"></div>
        </div>`;
      renderBodyInto("bodyPreview", req.requestBody);
      document.getElementById("copyBodyBtn")!.addEventListener("click", () => {
        if (!req.requestBody) return;
        let formatted = req.requestBody;
        try { formatted = JSON.stringify(JSON.parse(formatted), null, 2); } catch { /* not json */ }
        copyTextToClipboard(formatted, document.getElementById("copyBodyBtn")!, "📋 Copy");
      });
      break;

    case "response":
      content.innerHTML = `
        <div class="detail-section">
          <div class="section-header"><h3>Response Body ${req.responseSize != null ? "(" + formatSize(req.responseSize) + ")" : ""}</h3><button class="copy-btn" id="copyBodyBtn" title="Copy to clipboard">📋 Copy</button></div>
          <div class="body-preview" id="bodyPreview"></div>
        </div>`;
      renderBodyInto("bodyPreview", req.responseBody);
      document.getElementById("copyBodyBtn")!.addEventListener("click", () => {
        if (!req.responseBody) return;
        let formatted = req.responseBody;
        try { formatted = JSON.stringify(JSON.parse(formatted), null, 2); } catch { /* not json */ }
        copyTextToClipboard(formatted, document.getElementById("copyBodyBtn")!, "📋 Copy");
      });
      break;

    case "auth": {
      const token = getBearerToken(req);
      const decoded = token ? decodeJwt(token) : null;
      content.innerHTML = `
        ${decoded ? `<div class="detail-section">
          <h3>JWT Payload</h3>
          <div class="jwt-decoded"><pre class="jwt-payload">${escapeHtml(decoded)}</pre></div>
        </div>` : ""}
        <div class="detail-section">
          <h3>Authorization</h3>
          <div class="header-row"><span class="header-name">Type</span><span class="header-value">Bearer Token</span></div>
          <div class="header-row"><span class="header-name">Token</span><span class="header-value" style="word-break:break-all">${escapeHtml(token || "")}</span></div>
        </div>`;
      break;
    }

    case "action": {
      const chunks = req.responseBody ? parseRscPayload(req.responseBody) : [];
      const resolved = resolveRscData(chunks);
      const debugChunk = chunks.find((c) => c.type === "D");
      const serverTime = debugChunk && typeof debugChunk.data === "object" && debugChunk.data !== null
        ? (debugChunk.data as Record<string, unknown>).time : null;

      content.innerHTML = `
        <div class="detail-section">
          <h3>Server Action</h3>
          <div class="header-row"><span class="header-name">Function</span><span class="header-value">${escapeHtml(getActionName(req.url))}</span></div>
          <div class="header-row"><span class="header-name">Action ID</span><span class="header-value" style="word-break:break-all;color:#888;font-size:10px">${escapeHtml(req.actionId || "-")}</span></div>
          <div class="header-row"><span class="header-name">Status</span><span class="header-value">${req.status || "-"}</span></div>
          <div class="header-row"><span class="header-name">Duration</span><span class="header-value">${req.duration != null ? req.duration.toFixed(1) + "ms" : "-"}</span></div>
          ${serverTime != null ? `<div class="header-row"><span class="header-name">Server Time</span><span class="header-value">${Number(serverTime).toFixed(2)}ms</span></div>` : ""}
        </div>
        <div class="detail-section">
          <h3>Form Data</h3>
          <div class="body-preview" id="actionFormData"></div>
        </div>
        <div class="detail-section">
          <h3>Return Value (Parsed)</h3>
          <div class="body-preview" id="actionReturnValue"></div>
        </div>
`;
      renderBodyInto("actionFormData", req.requestBody);
      const rvContainer = document.getElementById("actionReturnValue")!;
      if (resolved && typeof resolved === "object") {
        rvContainer.appendChild(renderjson(resolved));
      } else {
        rvContainer.textContent = "(no data)";
      }
      break;
    }

    case "timing": {
      const maxDur = Math.max(...allRequests.map((r) => r.duration || 0), 1);
      const pct = ((req.duration || 0) / maxDur) * 100;
      content.innerHTML = `
        <div class="detail-section">
          <h3>Timing</h3>
          <div class="header-row"><span class="header-name">Duration</span><span class="header-value">${req.duration != null ? req.duration.toFixed(1) + "ms" : "-"}</span></div>
          <div style="margin-top:8px"><div class="timing-bar" style="width:${Math.max(pct, 1)}%"></div></div>
        </div>`;
      break;
    }
  }
}

function toCurl(req: NExtEvent): string {
  const skipHeaders = new Set(["host", "content-length"]);
  let cmd = `curl -X ${req.method} '${req.url}'`;
  if (req.requestHeaders) {
    for (const [k, v] of Object.entries(req.requestHeaders)) {
      if (skipHeaders.has(k.toLowerCase())) continue;
      cmd += ` \\\n  -H '${k}: ${v.replace(/'/g, "'\\''")}'`;
    }
  }
  if (req.requestBody) {
    cmd += ` \\\n  -d '${req.requestBody.replace(/'/g, "'\\''")}'`;
  }
  return cmd;
}

function copyTextToClipboard(text: string, btn: HTMLElement, label: string): void {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    btn.textContent = "✅ Copied!";
  } catch {
    btn.textContent = "❌ Failed";
  }
  setTimeout(() => { btn.textContent = label; }, 1500);
}

function decodeJwt(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return JSON.stringify(payload, null, 2);
  } catch {
    return null;
  }
}

function renderHeaders(headers: Record<string, string>): string {
  if (!headers || Object.keys(headers).length === 0) return "<div>(none)</div>";
  return Object.entries(headers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `<div class="header-row"><span class="header-name">${escapeHtml(k)}</span><span class="header-value">${escapeHtml(String(v))}</span></div>`)
    .join("");
}

function hasBearerToken(req: NExtEvent): boolean {
  if (!req.requestHeaders) return false;
  return Object.entries(req.requestHeaders).some(
    ([k, v]) => k.toLowerCase() === "authorization" && v.toLowerCase().startsWith("bearer ")
  );
}

function getBearerToken(req: NExtEvent): string | null {
  if (!req.requestHeaders) return null;
  for (const [k, v] of Object.entries(req.requestHeaders)) {
    if (k.toLowerCase() === "authorization" && v.toLowerCase().startsWith("bearer ")) {
      return v.slice(7);
    }
  }
  return null;
}

function renderBodyInto(elementId: string, body: string | null): void {
  const container = document.getElementById(elementId)!;
  if (!body) {
    container.textContent = "(empty)";
    return;
  }
  try {
    const parsed = JSON.parse(body);
    container.appendChild(renderjson(parsed));
  } catch {
    container.textContent = body;
  }
}

async function clearRequests(): Promise<void> {
  try {
    const res = await fetch(CLEAR_URL, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      cursor = data.cursor;
    }
  } catch { /* ignore */ }
  allRequests = [];
  closeDetail();
  applyFilters();
}

function toggleMethod(btn: HTMLElement): void {
  activeMethod = btn.dataset.method!;
  document.querySelectorAll("#methodFilters button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  applyFilters();
}

function getStatusClass(status: number | null): string {
  if (!status) return "status-err";
  if (status >= 200 && status < 300) return "status-2xx";
  if (status >= 300 && status < 400) return "status-3xx";
  if (status >= 400 && status < 500) return "status-4xx";
  return "status-5xx";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "KB";
  return (bytes / (1024 * 1024)).toFixed(1) + "MB";
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

const _escapeEl = document.createElement("div");
function escapeHtml(str: string): string {
  _escapeEl.textContent = str;
  return _escapeEl.innerHTML;
}

// Event delegation
document.getElementById("requestBody")!.addEventListener("click", (e) => {
  const row = (e.target as HTMLElement).closest("tr.row") as HTMLElement | null;
  if (row?.dataset.id) selectRequest(row.dataset.id);
});

document.getElementById("clearBtn")!.addEventListener("click", clearRequests);
document.getElementById("filterInput")!.addEventListener("input", applyFilters);

document.getElementById("methodFilters")!.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button[data-method]") as HTMLElement | null;
  if (btn) toggleMethod(btn);
});

document.getElementById("detailTabs")!.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button[data-tab]") as HTMLElement | null;
  if (btn) showTab(btn.dataset.tab!, btn);
});

document.getElementById("detailCloseBtn")!.addEventListener("click", closeDetail);

// Resize handle drag logic
(() => {
  const handle = document.getElementById("resizeHandle")!;
  const panel = document.getElementById("detailPanel")!;
  let dragging = false;
  let containerRight = 0;

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = true;
    containerRight = document.querySelector(".content")!.getBoundingClientRect().right;
    handle.classList.add("active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const newWidth = Math.max(200, Math.min(containerRight - e.clientX, window.innerWidth - 200));
    panel.style.width = newWidth + "px";
  });

  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("active");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });
})();

startPolling();
