/* Bootstrap: all panes are visible at once, so just init each module and
   poll gateway liveness (plain GET — no websockets). */
(function () {
  async function pollHealth() {
    const dot = document.getElementById("health-dot");
    const text = document.getElementById("health-text");
    try {
      const h = await api.health();
      const up = h.gateway_state === "running";
      dot.className = "health-dot " + (up ? "ok" : "err");
      text.textContent = up ? "gateway online" : (h.gateway_state || "degraded");
    } catch (_) {
      dot.className = "health-dot err";
      text.textContent = "unreachable";
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    for (const name of ["chat", "model", "sessions", "jobs", "status"]) {
      try { window.views[name] && window.views[name].init(); }
      catch (e) { console.error("init " + name + " failed", e); ui.toast("init " + name + " failed: " + e.message, true); }
    }
    pollHealth();
    setInterval(pollHealth, 15000);
  });
})();
