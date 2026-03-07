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
  source: "fetch" | "http";
}

let allRequests: NExtEvent[] = [];
let selectedRequest: NExtEvent | null = null;
let activeTab = "headers";
let activeMethod = "all";
let cursor = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

const SEE_URL = "http://127.0.0.1:3894/see";
const CLEAR_URL = "http://127.0.0.1:3894/clear";

function setStatus(_text: string, connected: boolean): void {
  const el = document.getElementById("statusIndicator")!;
  el.textContent = connected ? "🟢 Connected" : "🔴 Disconnected";
  el.className = "status " + (connected ? "connected" : "disconnected");
}

function closeDetail(): void {
  selectedRequest = null;
  document.getElementById("detailPanel")!.classList.remove("open");
  document.querySelectorAll("tr.row").forEach((row) => row.classList.remove("selected"));
}

async function poll(): Promise<void> {
  try {
    const url = cursor > 0 ? `${SEE_URL}?cursor=${cursor}` : SEE_URL;
    const res = await fetch(url);
    if (!res.ok) {
      setStatus("disconnected", false);
      return;
    }
    const data = await res.json();
    cursor = data.cursor;

    if (data.events.length > 0) {
      for (const event of data.events) {
        allRequests.unshift(event);
        if (allRequests.length > 200) allRequests.pop();
      }
      applyFilters();
    }

    setStatus("connected", true);
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

  if (activeMethod !== "all") {
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
      const source = req.source ? `<span class="source-badge">${req.source}</span>` : "";
      return `<tr class="row${selected}" data-id="${escapeHtml(req.id)}">
        <td class="${methodClass}">${req.method || "-"}</td>
        <td title="${escapeHtml(req.url || "")}">${escapeHtml(shortUrl)} ${source}</td>
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
    const authTab = document.getElementById("authTab") as HTMLElement;
    if (authTab) authTab.style.display = hasBearerToken(selectedRequest) ? "" : "none";
    if (activeTab === "auth" && !hasBearerToken(selectedRequest)) {
      activeTab = "headers";
      document.querySelectorAll(".detail-tabs button").forEach((b) => b.classList.remove("active"));
      document.querySelector('.detail-tabs button[data-tab="headers"]')?.classList.add("active");
    }
    renderDetail();
  } else {
    panel.classList.remove("open");
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
        </div>
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
      document.getElementById("copyBodyBtn")!.addEventListener("click", () => copyToClipboard(req.requestBody));
      break;

    case "response":
      content.innerHTML = `
        <div class="detail-section">
          <div class="section-header"><h3>Response Body ${req.responseSize != null ? "(" + formatSize(req.responseSize) + ")" : ""}</h3><button class="copy-btn" id="copyBodyBtn" title="Copy to clipboard">📋 Copy</button></div>
          <div class="body-preview" id="bodyPreview"></div>
        </div>`;
      renderBodyInto("bodyPreview", req.responseBody);
      document.getElementById("copyBodyBtn")!.addEventListener("click", () => copyToClipboard(req.responseBody));
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

function copyToClipboard(text: string | null): void {
  if (!text) return;
  const btn = document.getElementById("copyBodyBtn")!;
  try {
    let formatted = text;
    try { formatted = JSON.stringify(JSON.parse(text), null, 2); } catch { /* not json */ }
    const textarea = document.createElement("textarea");
    textarea.value = formatted;
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
  setTimeout(() => { btn.textContent = "📋 Copy"; }, 1500);
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
  selectedRequest = null;
  document.getElementById("detailPanel")!.classList.remove("open");
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

startPolling();
