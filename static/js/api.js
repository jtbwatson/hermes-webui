/* Hermes Web API client. Same-origin fetch to the proxy, which injects the
   Bearer key. Streaming uses fetch + ReadableStream SSE parsing — NO WebSockets,
   NO EventSource (the stream endpoint is POST). */
(function () {
  async function req(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }
    if (!res.ok) {
      const msg = (data && (data.error?.message || data.error || data.detail)) ||
                  `${res.status} ${res.statusText}`;
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    return data;
  }

  const api = {
    get: (p) => req("GET", p),
    post: (p, b) => req("POST", p, b),
    patch: (p, b) => req("PATCH", p, b),
    del: (p) => req("DELETE", p),

    // Sessions
    listSessions: () => api.get("/api/sessions"),
    createSession: (body) => api.post("/api/sessions", body || {}),
    getMessages: (id) => api.get(`/api/sessions/${encodeURIComponent(id)}/messages`),
    renameSession: (id, title) => api.patch(`/api/sessions/${encodeURIComponent(id)}`, { title }),
    deleteSession: (id) => api.del(`/api/sessions/${encodeURIComponent(id)}`),
    forkSession: (id, body) => api.post(`/api/sessions/${encodeURIComponent(id)}/fork`, body || {}),

    // Jobs
    listJobs: () => api.get("/api/jobs?include_disabled=true"),
    createJob: (body) => api.post("/api/jobs", body),
    deleteJob: (id) => api.del(`/api/jobs/${encodeURIComponent(id)}`),
    jobAction: (id, action) => api.post(`/api/jobs/${encodeURIComponent(id)}/${action}`, {}),

    // Status
    health: () => api.get("/health/detailed"),
    models: () => api.get("/v1/models"),
    skills: () => api.get("/v1/skills"),
    toolsets: () => api.get("/v1/toolsets"),

    // Model picker (local proxy endpoints; switches the GLOBAL Hermes model)
    listModels: () => api.get("/app/models"),
    setModel: (model, provider) => api.post("/app/model", { model, provider }),

    /* Stream a chat turn over SSE. handlers: {onEvent(name,data)}.
       Returns an AbortController so callers can stop the stream. */
    streamChat(sessionId, message, handlers) {
      const ctrl = new AbortController();
      (async () => {
        try {
          const res = await fetch(
            `/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message }),
              signal: ctrl.signal,
            }
          );
          if (!res.ok || !res.body) {
            const t = await res.text().catch(() => "");
            throw new Error(`stream failed: ${res.status} ${t}`.trim());
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            // SSE frames are separated by a blank line
            let idx;
            while ((idx = buf.indexOf("\n\n")) !== -1) {
              const frame = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              parseFrame(frame, handlers);
            }
          }
          if (buf.trim()) parseFrame(buf, handlers);
          handlers.onEvent && handlers.onEvent("_closed", {});
        } catch (err) {
          if (err.name === "AbortError") {
            handlers.onEvent && handlers.onEvent("_aborted", {});
          } else {
            handlers.onEvent && handlers.onEvent("error", { message: err.message });
          }
        }
      })();
      return ctrl;
    },
  };

  function parseFrame(frame, handlers) {
    let event = "message";
    const dataLines = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) continue; // keepalive comment
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length && event === "message") return;
    let data = {};
    if (dataLines.length) {
      try { data = JSON.parse(dataLines.join("\n")); } catch (_) { data = { raw: dataLines.join("\n") }; }
    }
    handlers.onEvent && handlers.onEvent(event, data);
  }

  // --- shared UI helpers ---
  let toastTimer = null;
  function toast(msg, isErr) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.className = "toast" + (isErr ? " err" : "");
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3800);
  }
  function fmtTime(ts) {
    if (!ts) return "—";
    const d = typeof ts === "number" ? new Date(ts * (ts < 1e12 ? 1000 : 1)) : new Date(ts);
    if (isNaN(d)) return String(ts);
    return d.toLocaleString();
  }
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  window.api = api;
  window.ui = { toast, fmtTime, el };
})();
