let allRequests = [];
let selectedRequest = null;
let activeTab = "headers";
let activeMethod = "all";
let eventSource = null;

function setStatus(text, connected) {
  const el = document.getElementById("statusIndicator");
  el.textContent = text;
  el.className = "status " + (connected ? "connected" : "disconnected");
}

function connect() {
  // Get the inspected page's URL to build the SSE endpoint
  chrome.devtools.inspectedWindow.eval("window.location.origin", (origin) => {
    if (!origin) {
      setStatus("no page", false);
      return;
    }

    const sseUrl = origin + "/api/nni/events";

    // We need to fetch with the page's cookies. Use the inspected page to create the connection.
    chrome.devtools.inspectedWindow.eval(`
      (function() {
        if (window.__nniEventSource) {
          window.__nniEventSource.close();
        }
        window.__nniEventSource = new EventSource(${JSON.stringify(sseUrl)});
        window.__nniRequests = window.__nniRequests || [];
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
      })()
    `, (result) => {
      if (result === "ok") {
        setStatus("connected", true);
        startPolling();
      } else {
        setStatus("failed", false);
      }
    });
  });
}

let pollInterval = null;

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(() => {
    chrome.devtools.inspectedWindow.eval(`
      (function() {
        var items = window.__nniRequests || [];
        window.__nniRequests = [];
        return JSON.stringify(items);
      })()
    `, (result) => {
      if (!result) return;
      try {
        const items = JSON.parse(result);
        for (const item of items) {
          try {
            const req = JSON.parse(item);
            allRequests.unshift(req);
            if (allRequests.length > 200) allRequests.pop();
          } catch {}
        }
        if (items.length > 0) applyFilters();
      } catch {}
    });

    // Check connection status
    chrome.devtools.inspectedWindow.eval("window.__nniConnected", (connected) => {
      setStatus(connected ? "connected" : "reconnecting...", !!connected);
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

// Row click via event delegation
document.getElementById("requestBody").addEventListener("click", (e) => {
  const row = e.target.closest("tr.row");
  if (row && row.dataset.id) {
    selectRequest(row.dataset.id);
  }
});

// Connect on panel open
connect();
