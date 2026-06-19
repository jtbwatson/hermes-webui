/* Model picker — shows the current global Hermes model in the chat header and
   lets you switch it. Switching writes ~/.hermes/config.yaml (GLOBAL: affects
   Telegram/Discord/etc. too), and the API server picks it up on the next chat. */
(function () {
  const nameEl = () => document.getElementById("chat-model-name");
  let loaded = false;
  let current = { model: "", provider: "" };
  let providers = [];

  async function refresh() {
    try {
      const data = await api.listModels();
      current = data.current || { model: "", provider: "" };
      providers = data.providers || [];
      nameEl().textContent = current.model || "model";
      if (data.error) ui.toast("model list: " + data.error, true);
    } catch (e) {
      nameEl().textContent = "model";
      ui.toast("models unavailable: " + e.message, true);
    }
  }

  function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

  function openPicker() {
    const backdrop = ui.el("div", "modal-backdrop");
    const modal = ui.el("div", "modal");
    modal.appendChild(ui.el("h2", "", "Switch model"));
    modal.appendChild(ui.el("p", "muted",
      `Current: <b>${esc(current.model || "—")}</b>${current.provider ? " · " + esc(current.provider) : ""}` +
      `<br><span style="font-size:12px">Changes the global model — applies to all platforms (Telegram, etc.), not just web.</span>`));

    const search = ui.el("input", "input");
    search.placeholder = "Filter models…"; search.style.margin = "6px 0 14px";
    modal.appendChild(search);

    const listWrap = ui.el("div");
    modal.appendChild(listWrap);

    function paint(filter) {
      listWrap.innerHTML = "";
      const f = (filter || "").toLowerCase();
      let any = false;
      for (const p of providers) {
        const models = (p.models || []).filter((m) => !f || m.toLowerCase().includes(f) || (p.label || "").toLowerCase().includes(f));
        if (!models.length) continue;
        any = true;
        listWrap.appendChild(ui.el("div", "section-label", esc(p.label || p.slug)));
        const chips = ui.el("div", "chips");
        for (const m of models) {
          const isCur = m === current.model && p.slug === current.provider;
          const chip = ui.el("button", "chip model-chip" + (isCur ? " on" : ""), esc(m));
          chip.onclick = () => choose(p.slug, m, backdrop);
          chips.appendChild(chip);
        }
        listWrap.appendChild(chips);
      }
      if (!any) listWrap.appendChild(ui.el("div", "empty", "No matching models."));
    }
    paint("");
    search.addEventListener("input", () => paint(search.value));

    const actions = ui.el("div", "modal-actions");
    const close = ui.el("button", "btn btn-ghost", "Close");
    close.onclick = () => backdrop.remove();
    actions.appendChild(close);
    modal.appendChild(actions);

    backdrop.appendChild(modal);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
    search.focus();
  }

  async function choose(provider, model, backdrop) {
    if (model === current.model && provider === current.provider) { backdrop.remove(); return; }
    nameEl().textContent = "switching…";
    try {
      const r = await api.setModel(model, provider);
      current = { model: r.model, provider: r.provider };
      nameEl().textContent = r.model;
      ui.toast(`Model → ${r.model} (${r.provider_label || r.provider})`);
      backdrop.remove();
    } catch (e) {
      ui.toast("switch failed: " + e.message, true);
      nameEl().textContent = current.model || "model";
    }
  }

  function init() {
    if (!loaded) {
      loaded = true;
      document.getElementById("chat-model").addEventListener("click", openPicker);
    }
    refresh();
  }

  window.views = window.views || {};
  window.views.model = { init, refresh };
})();
