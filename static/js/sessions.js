/* Left pane — sessions: click to open in chat; rename / fork / delete. */
(function () {
  const body = () => document.getElementById("sessions-body");
  let loaded = false;
  let activeId = null;
  let cache = [];
  let globalModel = null;

  function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

  async function fetchGlobalModel() {
    try {
      const data = await api.listModels();
      globalModel = (data.current && data.current.model) || null;
    } catch (e) { /* ignore */ }
  }

  async function refresh() {
    const host = body();
    let data;
    try { data = await api.listSessions(); }
    catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    cache = (data.data || data.sessions || []).filter((s) => !s.ended_at);
    if (!globalModel) await fetchGlobalModel();
    paint();
  }

  function paint() {
    const host = body();
    if (!cache.length) { host.innerHTML = '<div class="empty">No sessions yet.<br>Start one with “+ New chat”.</div>'; return; }
    const list = ui.el("div", "list");
    for (const it of cache) {
      const id = it.id || it.session_id;
      const row = ui.el("div", "row clickable" + (id === activeId ? " active" : ""));
      const main = ui.el("div", "row-main");
      const title = it.title || "New chat";
      const preview = it.preview || "";
      main.appendChild(ui.el("div", "row-title", esc(title)));
      const meta = [];
      if (it.message_count != null) meta.push(it.message_count + " msg");
      const model = (it.model && it.model !== "hermes-agent") ? it.model : globalModel;
      if (model) meta.push(model);
      if (it.started_at || it.created_at) meta.push(ui.fmtTime(it.started_at || it.created_at));
      main.appendChild(ui.el("div", "row-sub", esc(meta.join(" · ") || id)));
      main.onclick = () => window.views.chat.open(id, title);
      row.appendChild(main);

      const actions = ui.el("div", "row-actions");
      actions.appendChild(iconBtn("✎", "rename", (e) => { e.stopPropagation(); rename(id, it.title || ""); }));
      actions.appendChild(iconBtn("⑂", "fork", (e) => { e.stopPropagation(); fork(id); }));
      actions.appendChild(iconBtn("🗑", "delete danger", (e) => { e.stopPropagation(); del(id); }));
      row.appendChild(actions);
      list.appendChild(row);
    }
    host.innerHTML = "";
    host.appendChild(list);
  }

  function setActive(id) { activeId = id; paint(); }

  async function rename(id, current) {
    const title = prompt("New title:", current);
    if (title == null) return;
    try { await api.renameSession(id, title); ui.toast("Renamed"); refresh(); }
    catch (e) { ui.toast(e.message, true); }
  }
  async function fork(id) {
    try { const r = await api.forkSession(id, {}); ui.toast("Forked"); await refresh(); window.views.chat.open(r.session.id, r.session.title); }
    catch (e) { ui.toast(e.message, true); }
  }
  async function del(id) {
    if (!confirm("Delete this session?")) return;
    try {
      await api.deleteSession(id); ui.toast("Deleted");
      if (window.views.chat.getActiveId() === id) window.views.chat.open(null);
      refresh();
    } catch (e) { ui.toast(e.message, true); }
  }

  function iconBtn(label, cls, fn) { const b = ui.el("button", "icon-btn " + cls, label); b.onclick = fn; b.title = cls.split(" ")[0]; return b; }

  function init() {
    if (!loaded) { loaded = true; document.getElementById("sessions-refresh").addEventListener("click", refresh); }
    refresh();
  }

  window.views = window.views || {};
  window.views.sessions = { init, refresh, setActive };
})();
