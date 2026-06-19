/* Animated background — multiple modes: flow-field, pixel rain, twinkle grid.
   Pure canvas, no deps. Pauses when tab hidden; honors prefers-reduced-motion. */
(function () {
  const canvas = document.getElementById("bg-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: false });
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
  let raf = null;
  let mode = "rain";
  let t = 0;

  const BG = "#070809";
  const HUE_MIN = 120, HUE_MAX = 150;

  let flowParticles = [];
  let rainDrops = [];
  let twinkleGrid = [];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth = window.innerWidth;
    H = canvas.clientHeight = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    initMode(mode);
  }

  function initMode(m) {
    mode = m;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    if (m === "flow") initFlow();
    else if (m === "rain") initRain();
    else if (m === "twinkle") initTwinkle();
  }

  // --- Flow field ---
  function initFlow() {
    flowParticles = [];
    const target = Math.min(350, Math.round((W * H) / 6000));
    for (let i = 0; i < target; i++) flowParticles.push(spawnFlow());
  }

  function spawnFlow() {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      life: 0,
      max: 250 + Math.random() * 400,
      hue: HUE_MIN + Math.random() * (HUE_MAX - HUE_MIN),
      speed: 0.35 + Math.random() * 0.9,
      w: Math.random() < 0.3 ? 1.4 : 0.7,
    };
  }

  function angleAt(x, y, time) {
    const a =
      Math.sin(x * 0.0021 + time) +
      Math.sin(y * 0.0026 - time * 0.8) +
      Math.sin((x + y) * 0.0014 + time * 0.6) +
      Math.cos((x - y) * 0.0019 - time * 0.4);
    return a * 0.9 * Math.PI;
  }

  function drawFlow() {
    t += 0.0016;
    ctx.fillStyle = "rgba(7,8,9,0.08)";
    ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = "lighter";
    for (const p of flowParticles) {
      const ang = angleAt(p.x, p.y, t);
      const px = p.x, py = p.y;
      p.x += Math.cos(ang) * p.speed;
      p.y += Math.sin(ang) * p.speed;
      p.life++;

      const fade = Math.min(1, p.life / 30) * Math.min(1, (p.max - p.life) / 60);
      ctx.strokeStyle = `hsla(${p.hue}, 55%, 58%, ${0.18 * fade})`;
      ctx.lineWidth = p.w;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();

      if (p.life > p.max || p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) {
        Object.assign(p, spawnFlow());
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // --- Pixel rain ---
  function initRain() {
    rainDrops = [];
    const target = Math.min(400, Math.round((W * H) / 5000));
    for (let i = 0; i < target; i++) {
      const d = spawnRain();
      d.y = Math.random() * H;
      rainDrops.push(d);
    }
  }

  function spawnRain() {
    return {
      x: Math.random() * W,
      y: -10 - Math.random() * 100,
      speed: 0.5 + Math.random() * 1.5,
      size: 2 + Math.random() * 2,
      hue: HUE_MIN + Math.random() * (HUE_MAX - HUE_MIN),
      alpha: 0.15 + Math.random() * 0.25,
      life: 0,
    };
  }

  function drawRain() {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    for (const d of rainDrops) {
      d.y += d.speed;
      d.life++;

      const fadeIn = Math.min(1, d.life / 30);
      const fadeOut = Math.max(0, 1 - (d.y / H));
      const alpha = d.alpha * fadeIn * fadeOut;

      ctx.fillStyle = `hsla(${d.hue}, 60%, 65%, ${alpha})`;
      ctx.fillRect(Math.floor(d.x), Math.floor(d.y), d.size, d.size);

      if (d.y > H + 20) {
        Object.assign(d, spawnRain());
      }
    }
  }

  // --- Twinkle grid ---
  function initTwinkle() {
    twinkleGrid = [];
    const spacing = 12;
    const cols = Math.ceil(W / spacing);
    const rows = Math.ceil(H / spacing);
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        twinkleGrid.push({
          x: i * spacing,
          y: j * spacing,
          phase: Math.random() * Math.PI * 2,
          speed: 0.005 + Math.random() * 0.015,
          hue: HUE_MIN + Math.random() * (HUE_MAX - HUE_MIN),
        });
      }
    }
  }

  function drawTwinkle() {
    t += 0.0016;
    ctx.fillStyle = "rgba(7,8,9,0.15)";
    ctx.fillRect(0, 0, W, H);

    for (const p of twinkleGrid) {
      p.phase += p.speed;
      const brightness = (Math.sin(p.phase) + 1) / 2;
      const alpha = 0.05 + brightness * 0.2;
      ctx.fillStyle = `hsla(${p.hue}, 50%, 60%, ${alpha})`;
      ctx.fillRect(p.x, p.y, 3, 3);
    }
  }

  function frame() {
    if (mode === "flow") drawFlow();
    else if (mode === "rain") drawRain();
    else if (mode === "twinkle") drawTwinkle();
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (raf == null) raf = requestAnimationFrame(frame);
  }
  function stop() {
    if (raf != null) { cancelAnimationFrame(raf); raf = null; }
  }

  window.addEventListener("resize", () => { resize(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop(); else start();
  });

  resize();
  if (reduced) {
    for (let i = 0; i < 6; i++) frame();
    stop();
  } else {
    start();
  }

  window.setBgMode = (m) => {
    initMode(m);
    const btn = document.getElementById("bg-toggle");
    if (btn) {
      const labels = { flow: "≋ flow", rain: "▦ rain", twinkle: "✦ twinkle" };
      btn.textContent = labels[m] || m;
    }
  };

  const btn = document.getElementById("bg-toggle");
  if (btn) {
    const modes = ["rain", "flow", "twinkle"];
    btn.addEventListener("click", () => {
      const idx = modes.indexOf(mode);
      const next = modes[(idx + 1) % modes.length];
      window.setBgMode(next);
    });
    btn.textContent = "▦ rain";
  }
})();
