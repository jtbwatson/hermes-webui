/* Center pane — streaming chat over SSE. */
(function () {
  const thread = () => document.getElementById("chat-thread");
  const input = () => document.getElementById("chat-input");
  const sendBtn = () => document.getElementById("chat-send");
  const stopBtn = () => document.getElementById("chat-stop");
  const titleEl = () => document.getElementById("chat-title");

  let activeSession = null;
  let streaming = null;
  let loaded = false;
  let pendingApproval = null;

  const SUGGESTIONS = [
    "What can you help me with?",
    "Summarize my recent activity",
    "What tools and skills do you have?",
    "Draft a short status update for me",
  ];

  function scrollDown() { const t = thread(); t.scrollTop = t.scrollHeight; }
  function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

  function addMessage(role, content, isMarkdown) {
    const wrap = ui.el("div", "msg " + role);
    wrap.appendChild(ui.el("div", "avatar", role === "user" ? "🧑" : "✶"));
    const bubble = ui.el("div", "bubble");
    bubble.appendChild(ui.el("div", "msg-role", role === "user" ? "You" : "Hermes"));
    const body = ui.el("div", "msg-body md");
    if (isMarkdown) body.innerHTML = window.md(content || "");
    else body.textContent = content || "";
    bubble.appendChild(body);
    wrap.appendChild(bubble);
    thread().appendChild(wrap);
    scrollDown();
    return { wrap, bubble, body };
  }

  function showApprovalPrompt(code) {
    const wrap = ui.el("div", "msg assistant");
    wrap.appendChild(ui.el("div", "avatar", "✶"));
    const bubble = ui.el("div", "bubble");
    bubble.appendChild(ui.el("div", "msg-role", "Approval Required"));
    const body = ui.el("div", "msg-body approval-prompt");
    body.innerHTML = `
      <div class="approval-header">⚠️ Hermes wants to run code that requires approval:</div>
      <pre class="approval-code"><code>${esc(code)}</code></pre>
      <div class="approval-actions">
        <button class="btn btn-accent btn-approve" data-response="yes">✓ Approve</button>
        <button class="btn btn-deny" data-response="no">✗ Deny</button>
      </div>
    `;
    bubble.appendChild(body);
    wrap.appendChild(bubble);
    thread().appendChild(wrap);
    scrollDown();

    // Store pending approval
    pendingApproval = { wrap, bubble };

    // Add click handlers
    body.querySelector(".btn-approve").addEventListener("click", () => handleApproval("yes"));
    body.querySelector(".btn-deny").addEventListener("click", () => handleApproval("no"));
  }

  function handleApproval(response) {
    if (!pendingApproval) return;
    const { wrap } = pendingApproval;
    
    // Remove approval prompt
    wrap.remove();
    pendingApproval = null;

    // Send approval response as a message
    sendApprovalResponse(response);
  }

  async function sendApprovalResponse(response) {
    if (!activeSession || streaming) return;
    
    addMessage("user", response, false);
    const a = addMessage("assistant", "", true);
    a.body.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';

    let started = false, buffer = "";
    let activityLog = null;
    function ensureActivity() {
      if (activityLog) return;
      const box = ui.el("details", "activity");
      box.appendChild(ui.el("summary", "", "tool activity"));
      activityLog = ui.el("div", "activity-log");
      box.appendChild(activityLog);
      a.bubble.insertBefore(box, a.body.nextSibling);
    }
    function logActivity(html, kind) { ensureActivity(); activityLog.appendChild(ui.el("div", "activity-line" + (kind ? " " + kind : ""), html)); }
    function paint() { a.body.innerHTML = window.md(buffer); }

    setStreaming(true);
    streaming = api.streamChat(activeSession, response, {
      onEvent(name, data) {
        switch (name) {
          case "assistant.delta":
            if (!started) { started = true; a.body.classList.add("cursor"); a.body.innerHTML = ""; }
            buffer += data.delta || ""; paint(); scrollDown(); break;
          case "tool.started":
            logActivity(`▸ <span class="tn">${esc(data.tool_name || "tool")}</span> ${esc(data.preview || "")}`); break;
          case "tool.completed":
            logActivity(`✓ <span class="tn">${esc(data.tool_name || "tool")}</span> ${esc(data.preview || "")}`, "done"); break;
          case "tool.failed":
            logActivity(`✗ <span class="tn">${esc(data.tool_name || "tool")}</span> ${esc(data.preview || "")}`, "fail"); break;
          case "tool.progress":
            if (data.tool_name === "_thinking" && data.delta && !started) logActivity(`<span class="tn">thinking</span> ${esc(data.delta)}`); break;
          case "assistant.completed":
            if (data.content) { started = true; buffer = data.content; paint(); } break;
          case "run.completed": {
            a.body.classList.remove("cursor");
            if (!buffer) a.body.innerHTML = '<span class="muted">(no response)</span>';
            const u = data.usage;
            if (u) a.bubble.appendChild(ui.el("div", "usage", `${u.input_tokens || 0} in · ${u.output_tokens || 0} out · ${u.total_tokens || 0} tokens`));
            break;
          }
          case "error":
            a.body.classList.remove("cursor"); paint();
            a.body.innerHTML += `<p class="muted">⚠ ${esc(data.message || "stream error")}</p>`;
            ui.toast(data.message || "stream error", true); break;
          case "_aborted":
            a.body.classList.remove("cursor"); logActivity("■ stopped by user", "fail"); break;
          case "_closed":
            a.body.classList.remove("cursor"); setStreaming(false); streaming = null; scrollDown(); break;
        }
      },
    });
  }

  let lastToolFailed = null;

  function detectApprovalRequest(content) {
    if (!content) return null;
    console.log("Checking content for approval:", content.slice(0, 200));
    // Look for common approval request patterns in assistant response
    const patterns = [
      /Asking the user for approval/i,
      /requires? your approval/i,
      /needs? explicit approval/i,
      /approval is required/i,
      /requires? approval/i,
      /approve the execution/i,
      /flagged it for your review/i,
      /needs? your (?:explicit )?approval/i,
    ];
    for (const p of patterns) {
      if (p.test(content)) {
        console.log("Approval pattern matched:", p);
        // Try to extract the code block
        const codeMatch = content.match(/```(?:python|bash|sh|javascript)?\n([\s\S]*?)```/);
        if (codeMatch) return codeMatch[1];
        // If no code block, return the content itself (trimmed)
        return content.slice(0, 500);
      }
    }
    console.log("No approval pattern matched");
    return null;
  }

  function detectApprovalFromTool(toolName, preview) {
    // If a tool failed with approval-related content, we'll show approval prompt
    // when the assistant's response comes in
    if (toolName === "execute_code" || toolName === "terminal") {
      lastToolFailed = { toolName, preview, time: Date.now() };
    }
  }

  function showWelcome() {
    const t = thread(); t.innerHTML = "";
    const w = ui.el("div", "welcome");
    w.appendChild(ui.el("div", "mark", "✶"));
    w.appendChild(ui.el("h2", "", "Talk to Hermes"));
    w.appendChild(ui.el("p", "", "Your local agent, ready when you are. Ask anything, or try one of these:"));
    const sugg = ui.el("div", "suggestions");
    for (const s of SUGGESTIONS) {
      const b = ui.el("button", "suggestion", esc(s));
      b.onclick = () => { input().value = s; autosize(); input().focus(); };
      sugg.appendChild(b);
    }
    w.appendChild(sugg);
    t.appendChild(w);
  }

  // Open an existing session into the chat pane.
  async function open(id, title) {
    activeSession = id;
    titleEl().textContent = title || "Chat";
    if (window.views.sessions) window.views.sessions.setActive(id);
    thread().innerHTML = "";
    if (!id) { showWelcome(); return; }
    const data = await api.getMessages(id).catch((e) => { ui.toast(e.message, true); return null; });
    if (!data) return;
    const msgs = (data.data || []).filter((m) => m.role === "user" || m.role === "assistant");
    if (!msgs.length) { showWelcome(); return; }
    for (const m of msgs) addMessage(m.role === "user" ? "user" : "assistant", m.content || "", true);
  }

  async function newChat() {
    try {
      const r = await api.createSession({ title: "New chat" });
      const id = r.session.id;
      const title = "New chat";
      if (window.views.sessions) await window.views.sessions.refresh();
      await open(id, title);
      input().focus();
      return id;
    } catch (e) { ui.toast(e.message, true); return null; }
  }

  function setStreaming(on) {
    sendBtn().hidden = on;
    stopBtn().hidden = !on;
  }

  async function send() {
    try {
      const text = input().value.trim();
      if (!text || streaming) return;
      if (text.startsWith("/")) { input().value = ""; autosize(); await handleSlash(text); return; }
      if (!activeSession) { const id = await newChat(); if (!id) return; }

      const wasEmpty = !!thread().querySelector(".welcome");
      input().value = ""; autosize();
      if (wasEmpty) thread().innerHTML = "";

      addMessage("user", text, false);
      
      const a = addMessage("assistant", "", true);
      a.body.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';

      let started = false, buffer = "";
      let activityLog = null;
      function ensureActivity() {
        if (activityLog) return;
        const box = ui.el("details", "activity");
        box.appendChild(ui.el("summary", "", "tool activity"));
        activityLog = ui.el("div", "activity-log");
        box.appendChild(activityLog);
        a.bubble.insertBefore(box, a.body.nextSibling);
      }
      function logActivity(html, kind) { ensureActivity(); activityLog.appendChild(ui.el("div", "activity-line" + (kind ? " " + kind : ""), html)); }
      function paint() { a.body.innerHTML = window.md(buffer); }

      setStreaming(true);
      streaming = api.streamChat(activeSession, text, {
        onEvent(name, data) {
          switch (name) {
            case "assistant.delta":
              if (!started) { started = true; a.body.classList.add("cursor"); a.body.innerHTML = ""; }
              buffer += data.delta || ""; paint(); scrollDown(); break;
            case "tool.started":
              logActivity(`▸ <span class="tn">${esc(data.tool_name || "tool")}</span> ${esc(data.preview || "")}`); break;
            case "tool.completed":
              logActivity(`✓ <span class="tn">${esc(data.tool_name || "tool")}</span> ${esc(data.preview || "")}`, "done"); break;
            case "tool.failed":
              console.log("Tool failed:", data.tool_name, data.preview);
              detectApprovalFromTool(data.tool_name, data.preview);
              logActivity(`✗ <span class="tn">${esc(data.tool_name || "tool")}</span> ${esc(data.preview || "")}`, "fail"); break;
            case "tool.progress":
              if (data.tool_name === "_thinking" && data.delta && !started) logActivity(`<span class="tn">thinking</span> ${esc(data.delta)}`); break;
            case "assistant.completed":
              if (data.content) { 
                started = true; buffer = data.content; paint(); 
                console.log("Assistant completed, checking for approval...");
                // Check for approval request in final content
                const approvalCode = detectApprovalRequest(data.content);
                if (approvalCode) {
                  console.log("Showing approval prompt with code:", approvalCode.slice(0, 100));
                  showApprovalPrompt(approvalCode);
                } else if (lastToolFailed && (Date.now() - lastToolFailed.time < 5000)) {
                  console.log("Checking lastToolFailed:", lastToolFailed);
                  // Check if recent tool failure was approval-related
                  const codeFromPreview = lastToolFailed.preview || "";
                  if (/approval|approve|requires/i.test(codeFromPreview)) {
                    showApprovalPrompt(codeFromPreview);
                  }
                  lastToolFailed = null;
                }
              } break;
            case "run.completed": {
              a.body.classList.remove("cursor");
              if (!buffer) a.body.innerHTML = '<span class="muted">(no response)</span>';
              const u = data.usage;
              if (u) a.bubble.appendChild(ui.el("div", "usage", `${u.input_tokens || 0} in · ${u.output_tokens || 0} out · ${u.total_tokens || 0} tokens`));
              break;
            }
            case "error":
              a.body.classList.remove("cursor"); paint();
              a.body.innerHTML += `<p class="muted">⚠ ${esc(data.message || "stream error")}</p>`;
              ui.toast(data.message || "stream error", true); break;
            case "_aborted":
              a.body.classList.remove("cursor"); logActivity("■ stopped by user", "fail"); break;
            case "_closed":
              a.body.classList.remove("cursor"); setStreaming(false); streaming = null; scrollDown(); break;
          }
        },
      });
    } catch (e) {
      setStreaming(false); streaming = null;
      ui.toast("send failed: " + e.message, true);
    }
  }

  function stop() { if (streaming) streaming.abort(); }
  function autosize() { const t = input(); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 200) + "px"; }

  function note(md) {
    const w = thread().querySelector(".welcome"); if (w) thread().innerHTML = "";
    const el = ui.el("div", "sys-note md", window.md(md));
    thread().appendChild(el); scrollDown();
  }

  // Slash commands available without modifying Hermes (each maps to an API action).
  const HELP = [
    "**Available commands** (web-supported subset):",
    "- `/new` — start a new chat",
    "- `/model [name]` — open the model picker, or switch directly",
    "- `/fork` — branch the current session",
    "- `/rename <title>` — rename the current session",
    "- `/skills` — list installed skills",
    "- `/help` — show this list",
    "",
    "_Full Hermes slash commands (e.g. /compress, /memory) aren't exposed by the API server._",
  ].join("\n");

  async function handleSlash(text) {
    const [cmd, ...rest] = text.slice(1).split(/\s+/);
    const arg = text.slice(1 + cmd.length).trim();
    switch (cmd.toLowerCase()) {
      case "help": case "commands": case "?": note(HELP); break;
      case "new": case "clear": await newChat(); break;
      case "model":
        if (arg) {
          try { const r = await api.setModel(arg, ""); if (window.views.model) window.views.model.refresh(); ui.toast(`Model → ${r.model}`); }
          catch (e) { ui.toast("switch failed: " + e.message, true); }
        } else { document.getElementById("chat-model").click(); }
        break;
      case "fork":
        if (!activeSession) { ui.toast("No active session to fork", true); break; }
        try { const r = await api.forkSession(activeSession, {}); if (window.views.sessions) await window.views.sessions.refresh(); await open(r.session.id, r.session.title); ui.toast("Forked"); }
        catch (e) { ui.toast(e.message, true); } break;
      case "rename":
        if (!activeSession) { ui.toast("No active session", true); break; }
        if (!arg) { ui.toast("Usage: /rename <title>", true); break; }
        try { await api.renameSession(activeSession, arg); titleEl().textContent = arg; if (window.views.sessions) window.views.sessions.refresh(); ui.toast("Renamed"); }
        catch (e) { ui.toast(e.message, true); } break;
      case "skills":
        try { const d = await api.skills(); const names = (d.data || d.skills || []).map((s) => s.name || s); note("**Skills (" + names.length + "):** " + names.join(", ")); }
        catch (e) { ui.toast(e.message, true); } break;
      default:
        note("Unknown command `/" + esc(cmd) + "`. Type `/help` for the list.");
    }
  }

  function init() {
    if (loaded) return;
    loaded = true;
    document.getElementById("chat-form").addEventListener("submit", (e) => { e.preventDefault(); send(); });
    stopBtn().addEventListener("click", stop);
    document.getElementById("chat-new").addEventListener("click", newChat);
    input().addEventListener("input", autosize);
    input().addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
    showWelcome();
  }

  window.views = window.views || {};
  window.views.chat = { init, open, getActiveId: () => activeSession };
})();
