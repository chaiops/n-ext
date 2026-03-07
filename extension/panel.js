let allRequests = [];
let selectedRequest = null;
let activeTab = "headers";
let activeMethod = "all";
let eventSource = null;

let reconnectTimer = null;
let lastConnectedState = null;

function setStatus(text, connected) {
  const el = document.getElementById("statusIndicator");
  el.textContent = text;
  el.className = "status " + (connected ? "connected" : "disconnected");
}

function connect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  setStatus("⏳ connecting...", false);

  chrome.devtools.inspectedWindow.eval("window.location.origin", (origin) => {
    if (!origin) {
      setStatus("🔴 no page", false);
      scheduleReconnect();
      return;
    }

    const sseUrl = origin + "/api/nni/events";

    chrome.devtools.inspectedWindow.eval(`
      (function() {
        try {
          if (window.__nniEventSource) {
            window.__nniEventSource.close();
          }
          window.__nniRequests = window.__nniRequests || [];
          window.__nniEventSource = new EventSource(${JSON.stringify(sseUrl)});
          window.__nniEventSource.onmessage = function(e) {
            window.__nniRequests.push(e.data);
          };
          window.__nniEventSource.onerror = function() {
            window.__nniConnected = false;
          };
          window.__nniEventSource.onopen = function() {
            window.__nniConnected = true;
          };
          return "ok";
        } catch(e) {
          return "error:" + e.message;
        }
      })()
    `, (result, error) => {
      if (error || !result || result !== "ok") {
        setStatus("🔴 failed", false);
        scheduleReconnect();
        return;
      }
      setStatus("🟢 connected", true);
      lastConnectedState = true;
      startPolling();
    });
  });
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connect();
  }, 3000);
}

let pollInterval = null;

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(() => {
    chrome.devtools.inspectedWindow.eval(`
      (function() {
        var items = window.__nniRequests || [];
        window.__nniRequests = [];
        var connected = window.__nniConnected;
        var readyState = window.__nniEventSource ? window.__nniEventSource.readyState : -1;
        return JSON.stringify({ items: items, connected: connected, readyState: readyState });
      })()
    `, (result, error) => {
      if (error || !result) {
        if (lastConnectedState !== false) {
          setStatus("🔴 disconnected", false);
          lastConnectedState = false;
        }
        scheduleReconnect();
        return;
      }

      try {
        const data = JSON.parse(result);

        // Process new requests
        for (const item of data.items) {
          try {
            const req = JSON.parse(item);
            allRequests.unshift(req);
            if (allRequests.length > 200) allRequests.pop();
          } catch {}
        }
        if (data.items.length > 0) applyFilters();

        // Update connection status
        // readyState: 0=CONNECTING, 1=OPEN, 2=CLOSED
        if (data.readyState === 1 && data.connected) {
          if (lastConnectedState !== true) {
            setStatus("🟢 connected", true);
            lastConnectedState = true;
          }
        } else if (data.readyState === 0) {
          if (lastConnectedState !== null) {
            setStatus("🟡 reconnecting...", false);
            lastConnectedState = null;
          }
        } else {
          if (lastConnectedState !== false) {
            setStatus("🔴 disconnected", false);
            lastConnectedState = false;
          }
          // EventSource is closed or errored — reconnect
          if (pollInterval) clearInterval(pollInterval);
          pollInterval = null;
          scheduleReconnect();
        }
      } catch {
        setStatus("🔴 error", false);
        scheduleReconnect();
      }
    });
  }, 500);
}

function applyFilters() {
  const filter = document.getElementById("filterInput").value.toLowerCase();
  let filtered = allRequests;

  if (filter) {
    filtered = filtered.filter((r) => r.url && r.url.toLowerCase().includes(filter));
  }

  if (activeMethod !== "all") {
    filtered = filtered.filter((r) => r.method === activeMethod);
  }

  renderRequests(filtered);
}

function renderRequests(requests) {
  const tbody = document.getElementById("requestBody");
  const empty = document.getElementById("emptyState");

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

      return `<tr class="row${selected}" data-id="${escapeHtml(req.id)}">
        <td class="${methodClass}">${req.method || "-"}</td>
        <td title="${escapeHtml(req.url || "")}">${escapeHtml(shortUrl)}</td>
        <td class="${statusClass}">${req.error ? "ERR" : req.status || "-"}</td>
        <td>${duration}</td>
        <td>${size}</td>
        <td>${time}</td>
      </tr>`;
    })
    .join("");
}

function selectRequest(id) {
  selectedRequest = allRequests.find((r) => r.id === id) || null;
  const panel = document.getElementById("detailPanel");

  if (selectedRequest) {
    panel.classList.add("open");
    renderDetail();
  } else {
    panel.classList.remove("open");
  }

  document.querySelectorAll("tr.row").forEach((row) => {
    row.classList.toggle("selected", row.dataset.id === id);
  });
}

function showTab(tab, btn) {
  activeTab = tab;
  document.querySelectorAll(".detail-tabs button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  renderDetail();
}

function renderDetail() {
  const content = document.getElementById("detailContent");
  if (!selectedRequest) return;

  const req = selectedRequest;

  switch (activeTab) {
    case "headers":
      content.innerHTML = `
        <div class="detail-section">
          <h3>General</h3>
          <div class="header-row"><span class="header-name">URL</span><span class="header-value">${escapeHtml(req.url || "")}</span></div>
          <div class="header-row"><span class="header-name">Method</span><span class="header-value">${req.method || "-"}</span></div>
          <div class="header-row"><span class="header-name">Status</span><span class="header-value">${req.error ? "Error: " + escapeHtml(req.error) : (req.status || "-") + " " + (req.statusText || "")}</span></div>
          <div class="header-row"><span class="header-name">Duration</span><span class="header-value">${req.duration != null ? req.duration.toFixed(1) + "ms" : "-"}</span></div>
        </div>
        <div class="detail-section">
          <h3>Request Headers</h3>
          ${renderHeaders(req.requestHeaders)}
        </div>
        <div class="detail-section">
          <h3>Response Headers</h3>
          ${renderHeaders(req.responseHeaders)}
        </div>`;
      break;

    case "request":
      content.innerHTML = `
        <div class="detail-section">
          <h3>Request Body</h3>
          <div class="body-preview">${req.requestBody ? formatBody(req.requestBody) : "(empty)"}</div>
        </div>`;
      break;

    case "response":
      content.innerHTML = `
        <div class="detail-section">
          <h3>Response Body ${req.responseSize != null ? "(" + formatSize(req.responseSize) + ")" : ""}</h3>
          <div class="body-preview">${req.responseBody ? formatBody(req.responseBody) : "(empty)"}</div>
        </div>`;
      break;

    case "timing":
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

function renderHeaders(headers) {
  if (!headers || Object.keys(headers).length === 0) return "<div>(none)</div>";
  return Object.entries(headers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `<div class="header-row"><span class="header-name">${escapeHtml(k)}</span><span class="header-value">${escapeHtml(String(v))}</span></div>`)
    .join("");
}

function formatBody(body) {
  try {
    const parsed = JSON.parse(body);
    return escapeHtml(JSON.stringify(parsed, null, 2));
  } catch {
    return escapeHtml(body);
  }
}

function clearRequests() {
  allRequests = [];
  selectedRequest = null;
  document.getElementById("detailPanel").classList.remove("open");
  applyFilters();
}

function toggleMethod(btn) {
  activeMethod = btn.dataset.method;
  document.querySelectorAll("#methodFilters button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  applyFilters();
}

function getStatusClass(status) {
  if (!status) return "status-err";
  if (status >= 200 && status < 300) return "status-2xx";
  if (status >= 300 && status < 400) return "status-3xx";
  if (status >= 400 && status < 500) return "status-4xx";
  return "status-5xx";
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "KB";
  return (bytes / (1024 * 1024)).toFixed(1) + "MB";
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function shortenUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Event delegation — no inline handlers (CSP)
document.getElementById("requestBody").addEventListener("click", (e) => {
  const row = e.target.closest("tr.row");
  if (row && row.dataset.id) selectRequest(row.dataset.id);
});

document.getElementById("clearBtn").addEventListener("click", clearRequests);

document.getElementById("filterInput").addEventListener("input", applyFilters);

document.getElementById("methodFilters").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-method]");
  if (btn) toggleMethod(btn);
});

document.getElementById("detailTabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tab]");
  if (btn) showTab(btn.dataset.tab, btn);
});

// Reconnect when the inspected page navigates
chrome.devtools.network.onNavigated.addListener(() => {
  setTimeout(connect, 1000);
});

// Connect on panel open
connect();
