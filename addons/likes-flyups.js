/* Likes Pulse & Flyups v2.2 — lively tap feedback without blocking
   - Heart particles on every like tick (scaled by likeCount, capped)
   - Compact combo meter (likes / 10s), auto-decay
   - Avatar fly-in on per-user milestones (every 25 total likes)
   - Uses global avatar cache strategy compatible with your server frames
*/
(function () {
  function factory() {
    let styleEl = null, off = null, Kctx = null;
    let q = [], active = 0;
    const lastShown = Object.create(null);   // uidLc -> last totalLikeCount seen
    const AVATAR_CACHE = Object.create(null);
    const COMBO = { count: 0, lastTick: 0, el: null, timer: null };

    // ---------- Tunables ----------
    const MILESTONE = 25;        // avatar fly-in every N total likes per user
    const MAX_PARTICLES = 16;    // hard cap per like event
    const BASE_PARTICLES = 3;    // min burst when likeCount small
    const PARTICLE_MS = 1000;    // particle lifetime
    const COMBO_WINDOW_MS = 10000; // rolling combo window
    const LANES = 5;             // avatar lanes across height
    const MAX_CONCURRENT_FLYUPS = 3;

    // ---------- CSS ----------
    function css() {
      if (styleEl) return;
      styleEl = document.createElement('style');
      styleEl.textContent = `
/* hearts */
.kq-like-heart{position:fixed;right:8px;bottom:18vh;width:18px;height:18px;pointer-events:none;
  transform:translate(0,0) scale(1);opacity:.0;z-index:160;filter:drop-shadow(0 6px 12px rgba(0,0,0,.35))}
.kq-like-heart svg{width:100%;height:100%}
/* simple rise animation driven by inline style + rAF */

/* fly-in avatar */
.kq-like-item{position:fixed;right:-160px;display:flex;align-items:center;gap:10px;
  transform:translateX(0);opacity:0;filter:drop-shadow(0 8px 18px rgba(0,0,0,.45));z-index:180}
.kq-like-avatar{width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid #22314a;background:#0b1426}
.kq-like-initials{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font:900 22px/1 system-ui,Segoe UI,Roboto,Arial,sans-serif;color:#0b1426;background:#ffd700;border:2px solid #22314a}
.kq-like-tag{font:900 18px/1 system-ui,Segoe UI,Roboto,Arial,sans-serif;color:#e6edf7;text-shadow:0 2px 8px rgba(0,0,0,.6)}
@keyframes kqIn {0%{transform:translateX(0);opacity:0}30%{opacity:1}100%{transform:translateX(-50vw);opacity:1}}
@keyframes kqUp {0%{transform:translateY(0)}100%{transform:translateY(-110px);opacity:0}}
.kq-like-enter{animation:kqIn .9s ease-out forwards}
.kq-like-exit {animation:kqUp .8s ease-in forwards}

/* combo pill */
.kq-like-combo{position:fixed;right:10px;top:10px;z-index:185;pointer-events:none;
  background:rgba(15,23,42,.78);color:#e6edf7;border:1px solid rgba(255,255,255,.14);
  border-radius:999px;padding:6px 12px;font:700 14px/1 system-ui,Segoe UI,Roboto,Arial,sans-serif;
  box-shadow:0 6px 18px rgba(0,0,0,.35)}
.kq-like-combo .num{font-weight:900;margin-left:6px}
`;
      document.head.appendChild(styleEl);
    }

    // ---------- helpers ----------
    const lc = v => v == null ? '' : String(v).toLowerCase();
    const norm = u => !u ? '' : (String(u).startsWith('//') ? ('https:' + u) : String(u));
    const proxify = (url) => {
      if (!url) return "";
      try { if (Kctx?.util?.proxyURL) return Kctx.util.proxyURL(url); } catch { }
      return url;
    };
    function extractUid(ev) {
      const raw = (ev?.uniqueId || ev?.user?.uniqueId || ev?.userId || ev?.user?.userId || '') + '';
      return { raw, lc: raw.toLowerCase() };
    }
    function pickAvatarLike(ev, uidLc) {
      const direct =
        ev.avatar ||
        ev.profilePicture ||
        ev.profilePictureUrl ||
        ev.userProfilePictureUrl ||
        ev.user?.profilePictureUrl ||
        ev.user?.profilePicture ||
        ev.user?.profilePicture?.urlList?.[0] ||
        ev.user?.profilePicture?.urls?.[0] ||
        ev.user?.profilePicture?.url_list?.[0] ||
        "";
      if (direct) return direct;
      try {
        const p = Kctx?.state?.players?.[uidLc];
        return (p && (p.avatar || p.pfp)) || "";
      } catch { return ""; }
    }
    function hydrateCache(frame) {
      const ids = extractUid(frame);
      if (!ids.raw) return;
      const avatarRaw = pickAvatarLike(frame, ids.lc);
      const avatar = norm(avatarRaw);
      const name = frame?.displayName || frame?.nickname || frame?.user?.nickname || ids.raw;
      if (avatar && !AVATAR_CACHE[ids.raw]) AVATAR_CACHE[ids.raw] = { avatar, name };
      else if (!AVATAR_CACHE[ids.raw]) AVATAR_CACHE[ids.raw] = { avatar: "", name };
    }

    // ---------- particles ----------
    function heartSVG() {
      const wrap = document.createElement('div');
      wrap.className = 'kq-like-heart';
      wrap.innerHTML =
        `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
           <path fill="#ff3b6a" d="M12 21s-6.7-4.3-9.5-7.8C-0.2 9.7 1.3 5.8 4.7 4.6 6.9 3.8 9 4.5 10.4 6c1.4-1.5 3.5-2.2 5.7-1.4 3.4 1.2 4.9 5.1 2.2 8.6C18.7 16.7 12 21 12 21z"/>
         </svg>`;
      return wrap;
    }
    function spawnHearts(ev) {
      const nLike = Math.max(1, Number(ev?.likeCount || ev?.count || 1));
      // burst size scaled, capped
      const N = Math.min(MAX_PARTICLES, BASE_PARTICLES + Math.floor(Math.log2(1 + nLike)) * 2);

      for (let i = 0; i < N; i++) {
        const node = heartSVG();
        const h = window.innerHeight;
        const baseY = h * (0.28 + Math.random() * 0.44); // mid band
        const dx = 12 + Math.random() * 24;
        const dy = 80 + Math.random() * 140;
        const rot = (Math.random() * 40 - 20);
        const scale = 0.8 + Math.random() * 0.6;

        node.style.opacity = '0';
        node.style.transform = `translate(0px, 0px) scale(${scale})`;
        document.body.appendChild(node);

        const t0 = performance.now();
        function step(t) {
          const k = Math.min(1, (t - t0) / PARTICLE_MS);
          const ease = 1 - Math.pow(1 - k, 3);
          const x = -dx * ease;
          const y = -dy * ease;
          const o = 0.15 + 0.85 * ease;
          node.style.top = `${baseY}px`;
          node.style.transform = `translate(${x}px, ${y}px) rotate(${rot * ease}deg) scale(${scale})`;
          node.style.opacity = o.toFixed(3);
          if (k < 1) requestAnimationFrame(step);
          else node.remove();
        }
        requestAnimationFrame(step);
      }

      bumpCombo(nLike);
    }

    // ---------- combo ----------
    function ensureComboUI() {
      if (COMBO.el) return COMBO.el;
      const el = document.createElement('div');
      el.className = 'kq-like-combo';
      el.innerHTML = `Tap combo:<span class="num">0</span>/10s`;
      document.body.appendChild(el);
      COMBO.el = el;
      return el;
    }
    function bumpCombo(n) {
      const now = Date.now();
      if (!COMBO.el) ensureComboUI();
      COMBO.count += n;
      COMBO.lastTick = now;
      renderCombo();
      if (COMBO.timer) clearInterval(COMBO.timer);
      COMBO.timer = setInterval(() => {
        const dt = Date.now() - COMBO.lastTick;
        if (dt > COMBO_WINDOW_MS) { COMBO.count = Math.max(0, Math.floor(COMBO.count * 0.7)); renderCombo(); }
        if (dt > COMBO_WINDOW_MS * 2) { COMBO.count = 0; renderCombo(); clearInterval(COMBO.timer); COMBO.timer = null; }
      }, 1200);
    }
    function renderCombo() {
      if (!COMBO.el) return;
      const n = Math.max(0, COMBO.count);
      COMBO.el.querySelector('.num').textContent = String(n);
      // subtle size pulse
      COMBO.el.style.transform = 'scale(1.06)';
      clearTimeout(COMBO.__pulse);
      COMBO.__pulse = setTimeout(() => { COMBO.el.style.transform = 'scale(1)'; }, 120);
    }

    // ---------- avatar fly-in ----------
    function laneFor(idLc) {
      const h = (idLc || 'x').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
      const slot = h % LANES; const frac = 0.20 + (slot / (LANES - 1)) * 0.60; // 20%..80%
      return Math.round(window.innerHeight * frac);
    }
    function spawnFlyin(ev, laneY) {
      const ids = extractUid(ev);
      const cached = AVATAR_CACHE[ids.raw] || AVATAR_CACHE[ids.lc] || {};
      const fallbackAvatar = pickAvatarLike(ev, ids.lc);
      const avatar = proxify(cached.avatar || norm(fallbackAvatar));
      const name = ev?.displayName || ev?.nickname || ev?.user?.nickname || cached.name || ids.raw || "Žaidėjas";

      const y = Math.max(80, Math.min(window.innerHeight - 140, laneY));
      const box = document.createElement('div');
      box.className = 'kq-like-item kq-like-enter';
      box.style.top = `${y}px`;

      let avatarNode;
      if (avatar) {
        const img = document.createElement('img');
        img.className = 'kq-like-avatar';
        img.src = avatar;
        img.referrerPolicy = "no-referrer";
        img.crossOrigin = "anonymous";
        avatarNode = img;
      } else {
        const div = document.createElement('div');
        div.className = 'kq-like-initials';
        div.textContent = (name || '')[0]?.toUpperCase() || 'Ž';
        avatarNode = div;
      }

      const tag = document.createElement('div');
      tag.className = 'kq-like-tag';
      const n = Number(ev?.totalLikeCount || 0);
      tag.textContent = `❤️ ${n}  •  ${name}`;

      box.appendChild(avatarNode);
      box.appendChild(tag);
      document.body.appendChild(box);

      box.addEventListener('animationend', () => {
        if (box.classList.contains('kq-like-enter')) {
          box.classList.remove('kq-like-enter');
          box.classList.add('kq-like-exit');
        } else {
          box.remove();
          active = Math.max(0, active - 1);
          pump();
        }
      });
    }
    function pump() {
      if (!q.length) return;
      while (active < MAX_CONCURRENT_FLYUPS && q.length) {
        const { ev, laneY } = q.shift();
        active++; spawnFlyin(ev, laneY);
      }
    }

    // on each like tick
    function onLike(ev) {
      // particles per tick
      spawnHearts(ev);

      // per-user milestone fly-in
      const ids = extractUid(ev);
      const total = Number(ev?.totalLikeCount || 0);
      if (total < 1) return;

      const last = lastShown[ids.lc] || 0;
      if (Math.floor(total / MILESTONE) <= Math.floor(last / MILESTONE)) return;
      lastShown[ids.lc] = total;

      q.push({ ev, laneY: laneFor(ids.lc) });
      pump();
    }

    // ---------- wiring ----------
    function wire(K) {
      // hydrate avatar cache on any informative frame
      const hydrate = f => { try { hydrateCache(f || {}); } catch { } };
      ['chat', 'gift', 'follow', 'share'].forEach(ev => K.on && K.on(ev, hydrate));

      const likeH = e => onLike(e || {});
      const muxH = e => { hydrate(e); if (e && e.type === 'like') onLike(e); };

      K.on && K.on('like', likeH);
      K.on && K.on('wsMessage', muxH);

      // ensure combo pill exists
      ensureComboUI();

      return () => {
        try {
          ['chat', 'gift', 'follow', 'share'].forEach(ev => K.off && K.off(ev, hydrate));
          K.off && K.off('like', likeH);
          K.off && K.off('wsMessage', muxH);
        } catch { }
      };
    }

    return {
      id: 'likesFlyups',
      name: 'Likes Pulse + Flyups',
      description: 'Hearts + combo on every like tick; avatar fly-in on milestones.',
      defaultEnabled: true,
      enable(K) { css(); Kctx = K; off = wire(K); },
      disable() {
        try { off && off(); } catch { }
        document.querySelectorAll('.kq-like-item,.kq-like-heart,.kq-like-combo').forEach(n => n.remove());
        if (COMBO.timer) { clearInterval(COMBO.timer); COMBO.timer = null; }
      }
    };
  }

  function register(at = 0) {
    if (window.KQuiz?.registerAddon) {
      try { window.KQuiz.registerAddon(factory()); window.refreshAddonsUI && window.refreshAddonsUI(); }
      catch (e) { console.error('[likes-flyups] register fail', e); }
    } else if (at < 80) setTimeout(() => register(at + 1), 100);
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', register) : register();
})();
