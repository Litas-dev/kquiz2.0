/* KQuiz addon: Avatar Flyover (Canvas Edition) v2.0
 *
 * - Renders flying profile pictures via a single GPU-friendly canvas layer.
 * - Minimises DOM churn so large viewer counts keep 60fps.
 */
(function () {
  "use strict";

  function factory() {
    const ID = "avatarFlyover";
    const MAX_SPRITES = 80;
    const COOLDOWN_MS = 1600;
    const COLORS = ["#2ee5a9", "#69a9ff", "#ff9a62", "#ff62a1", "#ffe462"];

    let Kctx = null;
    let canvas = null;
    let ctx = null;
    let viewW = 0;
    let viewH = 0;
    let running = false;
    let raf = 0;

    const sprites = [];
    const cache = new Map();
    const lastByUser = Object.create(null);

    function resolveAvatar(raw) {
      if (!raw) return "";
      try {
        if (Kctx && Kctx.util && typeof Kctx.util.proxyURL === "function") {
          return Kctx.util.proxyURL(raw);
        }
      } catch {}
      return raw;
    }

    function loadAvatar(url) {
      if (!url) return null;
      let entry = cache.get(url);
      if (entry) return entry;
      const img = new Image();
      img.crossOrigin = "anonymous";
      entry = { img, ready: false, error: false };
      img.onload = () => {
        entry.ready = true;
      };
      img.onerror = () => {
        entry.error = true;
      };
      cache.set(url, entry);
      img.src = url;
      return entry;
    }

    function ensureCanvas() {
      if (canvas && ctx) return true;

      canvas = document.createElement("canvas");
      canvas.id = "kq-flyover-canvas";
      canvas.style.position = "fixed";
      canvas.style.inset = "0";
      canvas.style.pointerEvents = "none";
      canvas.style.zIndex = "70";
      canvas.style.willChange = "transform, opacity";

      const maybeBody = document.body || document.documentElement;
      maybeBody.appendChild(canvas);

      ctx = canvas.getContext("2d");
      if (!ctx) {
        cleanupCanvas();
        return false;
      }

      onResize();
      window.addEventListener("resize", onResize);
      return true;
    }

    function cleanupCanvas() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      running = false;
      sprites.length = 0;
      if (canvas) {
        window.removeEventListener("resize", onResize);
        try {
          canvas.remove();
        } catch {}
      }
      canvas = null;
      ctx = null;
    }

    function onResize() {
      if (!canvas || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      viewW = window.innerWidth || document.documentElement.clientWidth || 1280;
      viewH = window.innerHeight || document.documentElement.clientHeight || 720;
      canvas.width = Math.ceil(viewW * dpr);
      canvas.height = Math.ceil(viewH * dpr);
      canvas.style.width = viewW + "px";
      canvas.style.height = viewH + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, viewW, viewH);
    }

    function safeBottomPx() {
      try {
        const raw = getComputedStyle(document.documentElement).getPropertyValue("--safe-bottom");
        const n = parseFloat(raw);
        return Number.isFinite(n) ? Math.max(0, n) : 0;
      } catch {
        return 0;
      }
    }

    function spawnSprite(avatarUrl, displayName, flags) {
      if (!ensureCanvas()) return;

      if (sprites.length >= MAX_SPRITES) {
        sprites.shift();
      }

      const now = performance.now();
      const size = Math.round(Math.min(68, Math.max(44, viewW * 0.07)));
      const radius = size / 2;
      const safeBottom = safeBottomPx();
      const minY = radius + 8;
      const maxY = Math.max(minY + 20, viewH - safeBottom - radius - 12);
      const y = minY >= maxY ? minY : Math.random() * (maxY - minY) + minY;
      const duration = 2600 + Math.random() * 800;
      const entry = avatarUrl ? loadAvatar(avatarUrl) : null;

      sprites.push({
        start: now,
        duration,
        size,
        radius,
        y,
        letter: (displayName || "?").trim().charAt(0).toUpperCase() || "?",
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        entry,
        vip: !!flags.vip,
      });

      if (!running) {
        running = true;
        raf = requestAnimationFrame(loop);
      }
    }

    function drawSprite(s, progress) {
      if (!ctx) return;
      const x = -s.size + (viewW + s.size * 2) * progress;
      const centerX = x + s.radius;
      const centerY = s.y;

      let alpha = 1;
      if (progress < 0.1) {
        alpha = progress / 0.1;
      } else if (progress > 0.85) {
        alpha = Math.max(0, (1 - progress) / 0.15);
      }
      ctx.globalAlpha = alpha;

      if (s.entry && s.entry.ready && !s.entry.error) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(centerX, centerY, s.radius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(s.entry.img, x, centerY - s.radius, s.size, s.size);
        ctx.restore();

        if (s.vip) {
          ctx.save();
          ctx.lineWidth = 4;
          ctx.strokeStyle = "rgba(255, 215, 0, 0.85)";
          ctx.shadowColor = "rgba(255, 215, 0, 0.8)";
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.arc(centerX, centerY, s.radius + 2, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      } else {
        ctx.save();
        ctx.beginPath();
        ctx.fillStyle = s.color;
        ctx.shadowColor = "rgba(0,0,0,0.35)";
        ctx.shadowBlur = 16;
        ctx.arc(centerX, centerY, s.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#0b1220";
        ctx.font = `700 ${Math.round(s.size * 0.42)}px system-ui,Segoe UI,Roboto,sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(s.letter, centerX, centerY);
        ctx.restore();
      }
    }

    function loop(now) {
      if (!ctx) {
        running = false;
        return;
      }
      ctx.clearRect(0, 0, viewW, viewH);

      for (let i = sprites.length - 1; i >= 0; i--) {
        const s = sprites[i];
      const progress = (now - s.start) / s.duration;
      if (progress >= 1) {
        sprites.splice(i, 1);
        continue;
      }
      const clamped = Math.min(Math.max(progress, 0), 1);
      drawSprite(s, clamped);
      }

      ctx.globalAlpha = 1;

      if (sprites.length) {
        raf = requestAnimationFrame(loop);
      } else {
        running = false;
      }
    }

    function handleMessage(m) {
      if (!m || m.type !== "chat") return;
      const session = Kctx?.state?.session;
      if (!session || !session.open || !session.timerRunning) return;

      const key = Kctx.util?.parseAnswer ? Kctx.util.parseAnswer(String(m.text || "")) : null;
      if (!key) return;

      const uidRaw =
        m.uniqueId ||
        m.uid ||
        m.userId ||
        m.user?.uniqueId ||
        m.user?.userId ||
        m.user?.secUid ||
        "";
      const uid = String(uidRaw || "").toLowerCase();

      const now = Date.now();
      if (uid && (lastByUser[uid] || 0) + COOLDOWN_MS > now) return;
      if (uid) lastByUser[uid] = now;

      const avatar =
        m.profilePicture ||
        m.profilePictureUrl ||
        m.avatar ||
        m.user?.profilePicture ||
        m.user?.profilePictureUrl ||
        m.user?.avatarLarger?.urlList?.[0] ||
        m.user?.avatarMedium?.urlList?.[0] ||
        m.user?.avatarThumb?.urlList?.[0] ||
        "";
      const resolvedAvatar = resolveAvatar(avatar);
      const name =
        m.displayName ||
        m.nickname ||
        m.uniqueId ||
        m.user?.displayName ||
        m.user?.nickname ||
        m.user?.uniqueId ||
        uid ||
        "Zaidejas";

      const flags = {};
      try {
        if (window.KQ_VIP && typeof window.KQ_VIP.isVip === "function") {
          flags.vip = !!window.KQ_VIP.isVip(uid, name);
        }
      } catch {}

      spawnSprite(resolvedAvatar, name, flags);
    }

    function enable(K) {
      Kctx = K;
      ensureCanvas();
      K.on("wsMessage", handleMessage);
    }

    function disable() {
      try {
        if (Kctx) Kctx.off("wsMessage", handleMessage);
      } catch {}
      cache.clear();
      for (const key in lastByUser) delete lastByUser[key];
      cleanupCanvas();
      Kctx = null;
    }

    return {
      id: ID,
      name: "Avatar Flyover (Canvas)",
      description: "GPU-friendly flying avatars rendered on a single canvas to stay smooth above 80 viewers.",
      defaultEnabled: true,
      enable,
      disable,
    };
  }

  function register() {
    if (!window.KQuiz || !window.KQuiz.registerAddon) {
      return setTimeout(register, 120);
    }
    window.KQuiz.registerAddon(factory());
  }
  register();
})();
