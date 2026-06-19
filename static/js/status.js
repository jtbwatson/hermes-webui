/* 04 Status — health, models, skills, toolsets. */
(function () {
  const body = () => document.getElementById("status-body");
  let loaded = false;

  async function render() {
    const host = body();
    host.innerHTML = '<div class="empty">Loading…</div>';
    const [health, models, skills, toolsets] = await Promise.all([
      api.health().catch((e) => ({ error: e.message })),
      api.models().catch((e) => ({ error: e.message })),
      api.skills().catch((e) => ({ error: e.message })),
      api.toolsets().catch((e) => ({ error: e.message })),
    ]);

    host.innerHTML = "";

    // --- health cards ---
    host.appendChild(ui.el("div", "section-label", "Gateway"));
    const cards = ui.el("div", "cards");
    const up = health.gateway_state === "running";
    cards.appendChild(card("Gateway", health.gateway_state || (health.error ? "unreachable" : "—"), !up));
    cards.appendChild(card("Version", health.version || "—", false, true));
    cards.appendChild(card("PID", health.pid != null ? String(health.pid) : "—", false, true));
    cards.appendChild(card("Active agents", health.active_agents != null ? String(health.active_agents) : "—"));
    host.appendChild(cards);

    // --- platforms ---
    const platforms = health.platforms || {};
    if (Object.keys(platforms).length) {
      host.appendChild(ui.el("div", "section-label", "Connected platforms"));
      const chips = ui.el("div", "chips");
      for (const [name, p] of Object.entries(platforms)) {
        const ok = (p && p.state) === "connected";
        const chip = ui.el("span", "chip " + (ok ? "on" : ""), `${name} · ${p && p.state || "?"}`);
        chips.appendChild(chip);
      }
      host.appendChild(chips);
    }

    // --- models ---
    host.appendChild(ui.el("div", "section-label", "Models"));
    if (models.error) host.appendChild(ui.el("div", "muted", models.error));
    else {
      const chips = ui.el("div", "chips");
      for (const m of (models.data || [])) chips.appendChild(ui.el("span", "chip on", m.id));
      host.appendChild(chips);
    }

    // --- skills (collapsible) ---
    host.appendChild(detailsBlock("Skills", skills, (d) => {
      const arr = d.skills || d.data || [];
      if (!arr.length) return ui.el("div", "muted", "none");
      const chips = ui.el("div", "chips");
      for (const s of arr) {
        const name = s.name || s;
        const c = ui.el("span", "chip", name);
        if (s.description) c.title = s.description;
        chips.appendChild(c);
      }
      return chips;
    }));

    // --- toolsets (collapsible) ---
    host.appendChild(detailsBlock("Toolsets", toolsets, (d) => {
      const arr = d.toolsets || d.data || [];
      if (!arr.length) return ui.el("div", "muted", "none");
      const list = ui.el("div", "list");
      for (const t of arr) {
        const row = ui.el("div", "row");
        const main = ui.el("div", "row-main");
        const enabled = t.enabled !== false;
        const tr = ui.el("div", "row-title");
        tr.textContent = t.name || t.id || "toolset";
        const b = ui.el("span", "badge " + (enabled ? "ok" : "off"), enabled ? "enabled" : "disabled");
        b.style.marginLeft = "10px"; tr.appendChild(b);
        main.appendChild(tr);
        const tools = t.tools || t.resolved_tools || [];
        if (tools.length) main.appendChild(ui.el("div", "row-sub", tools.join(", ")));
        row.appendChild(main);
        list.appendChild(row);
      }
      return list;
    }));
  }

  function card(k, v, isErr, small) {
    const c = ui.el("div", "card");
    c.appendChild(ui.el("div", "k", k));
    const val = ui.el("div", "v" + (small ? " small" : ""), "");
    val.textContent = v;
    if (isErr) val.style.color = "var(--err)";
    c.appendChild(val);
    return c;
  }

  function detailsBlock(title, data, builder) {
    const d = ui.el("details", "activity");
    d.style.marginTop = "20px";
    const count = data && !data.error
      ? ((data.skills || data.toolsets || data.data || []).length) : "!";
    d.appendChild(ui.el("summary", "", `${title} (${count})`));
    const inner = ui.el("div");
    inner.style.padding = "8px 12px 14px";
    if (data && data.error) inner.appendChild(ui.el("div", "muted", data.error));
    else inner.appendChild(builder(data || {}));
    d.appendChild(inner);
    return d;
  }

  function init() {
    if (!loaded) {
      loaded = true;
      document.getElementById("status-refresh").addEventListener("click", render);
    }
    render();
  }

  window.views = window.views || {};
  window.views.status = { init, refresh: render };
})();
