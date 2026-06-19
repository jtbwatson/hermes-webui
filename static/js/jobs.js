/* Right pane (top) — Hermes cron jobs. */
(function () {
  const body = () => document.getElementById("jobs-body");
  let loaded = false;

  function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
  function truncate(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + "…" : s; }

  async function render() {
    const host = body();
    let data;
    try { data = await api.listJobs(); }
    catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const jobs = data.jobs || [];
    if (!jobs.length) { host.innerHTML = '<div class="empty">No scheduled jobs.<br>Add one with “+”.</div>'; return; }

    const list = ui.el("div", "list");
    for (const j of jobs) {
      const id = j.id || j.name;
      const paused = j.state === "paused" || j.enabled === false || j.paused === true;
      const row = ui.el("div", "row");
      const main = ui.el("div", "row-main");
      const tr = ui.el("div", "row-title");
      tr.textContent = j.name || id;
      const badge = ui.el("span", "badge " + (paused ? "off" : "ok"), j.state || (paused ? "paused" : "active"));
      badge.style.marginLeft = "8px"; tr.appendChild(badge);
      main.appendChild(tr);
      const sched = j.schedule_display || (j.schedule && (j.schedule.display || j.schedule.expr)) || j.schedule;
      main.appendChild(ui.el("div", "row-sub", esc((sched ? "⏱ " + sched : "") + (j.prompt ? " — " + truncate(j.prompt, 40) : ""))));
      row.appendChild(main);

      const actions = ui.el("div", "row-actions");
      actions.appendChild(iconBtn("▶", "run now", () => act(id, "run")));
      actions.appendChild(iconBtn(paused ? "⏵" : "⏸", paused ? "resume" : "pause", () => act(id, paused ? "resume" : "pause")));
      actions.appendChild(iconBtn("🗑", "delete danger", () => del(id)));
      row.appendChild(actions);
      list.appendChild(row);
    }
    host.innerHTML = "";
    host.appendChild(list);
  }

  async function act(id, action) {
    try { await api.jobAction(id, action); ui.toast("Job " + action); render(); }
    catch (e) { ui.toast(e.message, true); }
  }
  async function del(id) {
    if (!confirm("Delete this job?")) return;
    try { await api.deleteJob(id); ui.toast("Deleted"); render(); }
    catch (e) { ui.toast(e.message, true); }
  }

  function openCreate() {
    const backdrop = ui.el("div", "modal-backdrop");
    const modal = ui.el("div", "modal");
    modal.innerHTML = `
      <h2>New scheduled job</h2>
      <label class="field"><span>Name</span><input class="input" id="jb-name" placeholder="daily-digest"></label>
      <label class="field"><span>Schedule (cron, e.g. "0 9 * * *")</span><input class="input" id="jb-sched" placeholder="0 9 * * *"></label>
      <label class="field"><span>Prompt</span><textarea class="textarea" id="jb-prompt" rows="4" placeholder="What should Hermes do?"></textarea></label>
      <label class="field"><span>Deliver to (optional)</span><input class="input" id="jb-deliver" placeholder="local"></label>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="jb-cancel">Cancel</button>
        <button class="btn btn-accent" id="jb-save">Create</button>
      </div>`;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    modal.querySelector("#jb-cancel").onclick = close;
    modal.querySelector("#jb-save").onclick = async () => {
      const payload = {
        name: modal.querySelector("#jb-name").value.trim(),
        schedule: modal.querySelector("#jb-sched").value.trim(),
        prompt: modal.querySelector("#jb-prompt").value,
        deliver: modal.querySelector("#jb-deliver").value.trim() || "local",
      };
      if (!payload.name || !payload.schedule) { ui.toast("Name and schedule are required", true); return; }
      try { await api.createJob(payload); ui.toast("Job created"); close(); render(); }
      catch (e) { ui.toast(e.message, true); }
    };
    modal.querySelector("#jb-name").focus();
  }

  function iconBtn(label, cls, fn) { const b = ui.el("button", "icon-btn " + cls, label); b.onclick = fn; b.title = cls.split(" ")[0]; return b; }

  function init() {
    if (!loaded) {
      loaded = true;
      document.getElementById("jobs-refresh").addEventListener("click", render);
      document.getElementById("jobs-new").addEventListener("click", openCreate);
    }
    render();
  }

  window.views = window.views || {};
  window.views.jobs = { init, refresh: render };
})();
