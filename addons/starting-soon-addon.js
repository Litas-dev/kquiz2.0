/* KQuiz Addon: Break Overlay v1.4
   - Shows centered image logo.png above "Pertrauka"
   - Works with + / - / Space / S keys
   - Keeps game GUI visible under transparent overlay
*/
(function () {
  "use strict";

  function factory() {
    let mounted = false, wrap = null, styleEl = null, tickId = null;
    let left = 180, paused = false, visible = false;

    // ---------- CSS ----------
    const css = `
.kq-break-wrap {
  position: fixed; inset: 0; z-index: 150;
  display: none; align-items: center; justify-content: center;
  background: rgba(10,16,30,.55); backdrop-filter: blur(2px);
}
.kq-break-card {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 16px 22px; border-radius: 18px;
  background: rgba(12,18,36,.92);
  border: 1px solid rgba(255,255,255,.12);
  box-shadow: 0 14px 34px rgba(0,0,0,.45);
}
.kq-break-sticker {
  width: min(400px,60vw);
  height: auto;
  object-fit: contain;
  margin-bottom: 10px;
}

.kq-break-title {
  font: 1000 clamp(18px,2.8vw,28px)/1.05 system-ui,Segoe UI,Roboto,Arial;
  color: #eaf0ff;
}
.kq-break-clock {
  font: 1000 clamp(42px,7.5vw,92px)/1.05 system-ui;
  color: #fff; font-variant-numeric: tabular-nums;
}
.kq-break-ctrls {
  display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; margin-top: 6px;
}
.kqb-btn {
  padding: 10px 14px; border-radius: 12px;
  border: 1px solid rgba(255,255,255,.14);
  background: #0e162b; color: #f3f6fc;
  font: 900 14px/1 system-ui; cursor: pointer;
}
.kqb-btn.ok { background: #123a2a; border-color: #1d5a47; }
.kqb-hint {
  color: #9fb0c6; font: 800 12px/1 system-ui; margin-top: 4px;
}
`;

    const pad = (n) => String(n).padStart(2, "0");
    const fmt = (sec) => {
      sec = Math.max(0, sec | 0);
      const m = (sec / 60) | 0, s = sec % 60;
      return pad(m) + ":" + pad(s);
    };

    // find path to image in same folder as this script
    function assetInSameDir(name) {
      try {
        if (window.KQ_ASSETS?.image) return window.KQ_ASSETS.image(name);
      } catch {}
      const s = document.currentScript || [...document.querySelectorAll("script[src]")].pop();
      const base = new URL(s.src, location.href);
      base.pathname = base.pathname.replace(/[^/]+$/, ""); // keep folder
      const resolved = new URL(name, base).href;
      return resolved.includes("/addons/") ? resolved.replace("/addons/", "/assets/images/") : resolved;
    }

    function render() {
      if (!wrap) return;
      wrap.querySelector(".kq-break-clock").textContent = fmt(left);
      const btn = wrap.querySelector(".kqb-btn[data-act='pause']");
      if (btn) btn.textContent = paused ? "Tęsti laikmatį" : "Pauzė";
    }

    function tick() {
      if (!visible || paused) return;
      left = Math.max(0, left - 1);
      render();
      if (left === 0) finish();
    }

    function show() {
      if (!mounted) mount();
      try { window.KQuiz?.control?.pauseMain?.(); } catch {}
      wrap.style.display = "flex";
      visible = true;
      if (!tickId) tickId = setInterval(tick, 1000);
    }

    function hide() {
      if (!mounted) return;
      wrap.style.display = "none";
      visible = false;
      if (tickId) { clearInterval(tickId); tickId = null; }
    }

    function finish() {
      hide();
      try { window.KQuiz?.control?.resumeFlow?.(); } catch {}
    }

    function onKey(e) {
      const k = (e.key || "");
      if (k === "+" || k === "=") { e.preventDefault(); if (!visible) show(); left += 60; render(); return; }
      if (k === "-" || k === "_") { e.preventDefault(); if (!visible) show(); left = Math.max(0, left - 60); render(); return; }
      if (!visible) return;
      if (k === " ") { e.preventDefault(); paused = !paused; render(); return; }
      if (k.toLowerCase() === "s") { e.preventDefault(); finish(); return; }
    }

    function mount() {
      if (mounted) return;
      styleEl = document.createElement("style");
      styleEl.textContent = css;
      document.head.appendChild(styleEl);

      wrap = document.createElement("div");
      wrap.className = "kq-break-wrap";
      wrap.innerHTML = `
        <div class="kq-break-card">
          <img class="kq-break-sticker" src="${assetInSameDir("logo.png")}" alt="logo">
          <div class="kq-break-title">Greit pradėsime</div>
          <div class="kq-break-clock">03:00</div>
          <div class="kq-break-ctrls">
            <button class="kqb-btn" data-act="pause">Pauzė</button>
            <button class="kqb-btn ok" data-act="resume">Tęsti žaidimą</button>
          </div>
        </div>`;
      document.body.appendChild(wrap);

      wrap.addEventListener("click", (e) => {
        const act = e.target?.getAttribute?.("data-act");
        if (!act) return;
        if (act === "+1") { left += 60; render(); }
        if (act === "-1") { left = Math.max(0, left - 60); render(); }
        if (act === "pause") { paused = !paused; render(); }
        if (act === "resume") { finish(); }
      });

      document.addEventListener("keydown", onKey, { passive: false });
      render();
      mounted = true;
    }

    function unmount() {
      if (!mounted) return;
      document.removeEventListener("keydown", onKey);
      hide();
      try { wrap?.remove(); } catch {}
      try { styleEl?.remove(); } catch {}
      wrap = null; styleEl = null; mounted = false;
    }

    return {
      id: "breakOverlay",
      name: "Pertrauka (Overlay su logotipu)",
      description: "Skaidrus laikmatis su logotipu ir klavišais + / - / Space / S.",
      defaultEnabled: true,
      enable() { mount(); },
      disable() { unmount(); }
    };
  }

  // register safely
  (function register() {
    if (window.KQuiz?.registerAddon) {
      try { window.KQuiz.registerAddon(factory()); } catch (e) { console.error("[breakOverlay] register fail", e); }
    } else setTimeout(register, 200);
  })();
})();

