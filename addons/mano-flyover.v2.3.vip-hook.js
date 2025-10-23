/* KQuiz addon: "!mano" Flyover v2.2 (queued, non-blocking, bottom-center, x2 size)
   - Chat command: !mano
   - Larger toast (≈2x): big round avatar + name + rank
   - Bottom-center, no overlay, no pause
   - FIFO queue: one visible at a time
   - Per-user cooldown: 10s
*/
(function () {
  function factory() {
    let mounted = false, wrap = null, styleEl = null;
    const cooldown = new Map();
    const COOLDOWN_MS = 10000;
    const SHOW_MS = 2500;
    const FADE_MS = 220;
    const q = [];
    let running = false;

    const el = (t, a = {}, ...cs) => {
      const n = document.createElement(t);
      for (const [k,v] of Object.entries(a)) k === "class" ? n.className = v : n.setAttribute(k, v);
      cs.forEach(c => n.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
      return n;
    };

    function mountUI() {
      if (mounted) return;
      styleEl = el("style", {}, `
/* container bottom-center, non-blocking */
.kq-mano-wrap{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);display:block;z-index:120;pointer-events:none}
/* x2 compact toast card */
.kq-mano-card{display:flex;align-items:center;gap:16px;padding:16px 20px;border-radius:999px;
  background:rgba(12,18,36,.92);border:1px solid #1e2a3b;color:#e6edf7;
  font:900 16px/1.1 system-ui,Segoe UI,Roboto,Arial,sans-serif;
  box-shadow:0 10px 26px rgba(0,0,0,.35);
  opacity:0; transform:translateY(10px) scale(.98);
  transition:opacity ${FADE_MS}ms ease,transform ${FADE_MS}ms ease}
.kq-mano-card.show{opacity:1; transform:translateY(0) scale(1)}
.kq-mano-card.hide{opacity:0; transform:translateY(10px) scale(.98)}
.kq-mano-av{width:68px;height:68px;border-radius:50%;object-fit:cover;border:2px solid #2b3c5c;background:#0b1220}
.kq-mano-name{font-weight:1000;white-space:nowrap;max-width:40ch;overflow:hidden;text-overflow:ellipsis}
.kq-mano-rank{font-weight:1000;color:#9fb0c6;white-space:nowrap;margin-left:8px}
@media (min-width:980px){.kq-mano-card{font-size:18px}}
`);
      document.head.appendChild(styleEl);

      wrap = el("div", { class: "kq-mano-wrap", id: "kqManoWrap" });
      document.body.appendChild(wrap);
      mounted = true;
    }

    function proxy(K, url){
      try { return K.util && K.util.proxyURL ? K.util.proxyURL(url) : url; } catch { return url; }
    }

    function computeRank(K, id){
      const arr = Object.entries(K.state.players || {}).map(([pid,p]) => ({ id: pid, s: +p.score || 0 }));
      arr.sort((a,b)=> b.s - a.s || a.id.localeCompare(b.id));
      const idx = arr.findIndex(x => x.id === id);
      return idx === -1 ? null : (idx + 1);
    }

    function ensurePlayer(K, m){
      const id = String(m.uid || m.userId || "").toLowerCase();
      if (!id) return null;
      const p = K.state.players[id] || (K.state.players[id] = { name: m.displayName || id, avatar: m.profilePictureUrl || "", score: 0 });
      if (m.displayName && p.name !== m.displayName) p.name = m.displayName;
      if (m.profilePictureUrl && p.avatar !== m.profilePictureUrl) p.avatar = m.profilePictureUrl;
      return { id, p };
    }

    function showOnce(K, id, done){
      const p = K.state.players[id];
      if (!p) return done && done();

      const rank = computeRank(K, id);
      const card = el("div", { class: "kq-mano-card" });
      const img  = el("img", { class: "kq-mano-av kq-av kquiz-avatar", src: proxy(K, p.avatar || ""), alt: p.name || id, 'data-name': p.name || id, referrerpolicy: 'no-referrer' });
      const text = el("div", {},
        el("span", { class: "kq-mano-name" }, p.name || id),
        el("span", { class: "kq-mano-rank" }, rank ? `#${rank}` : "—")
      );
      card.append(img, text);
      wrap.appendChild(card);

      try{ if(window.KQ_VIP && typeof window.KQ_VIP.scan==='function') window.KQ_VIP.scan(); }catch{}

      requestAnimationFrame(()=> card.classList.add("show"));
      setTimeout(() => {
        card.classList.remove("show");
        card.classList.add("hide");
        setTimeout(() => { if (card.parentNode) card.parentNode.removeChild(card); done && done(); }, FADE_MS);
      }, SHOW_MS);
    }

    function pump(K){
      if (running) return;
      const next = q.shift();
      if (!next) return;
      running = true;
      showOnce(K, next.id, () => { running = false; pump(K); });
    }

    function onWs(m){
      if (!m || m.type !== "chat") return;
      const txt = String(m.text || "").trim();
      if (!/^!mano\b/i.test(txt)) return;

      const now = Date.now();
      const uid = String(m.uid || m.userId || "").toLowerCase();
      if (!uid) return;

      const last = cooldown.get(uid) || 0;
      if (now - last < COOLDOWN_MS) return;
      cooldown.set(uid, now);

      const ctx = ensurePlayer(window.KQuiz, m);
      if (!ctx) return;

      if (!q.some(x => x.id === ctx.id)) q.push({ id: ctx.id });
      pump(window.KQuiz);
    }

    return {
      id: "manoFlyover",
      name: "!mano Flyover",
      description: 'Bottom-center toast with large avatar, name, rank. Queued, non-blocking.',
      defaultEnabled: true,
      enable(K){
        mountUI();
        K.on && K.on("wsMessage", onWs);
      },
      disable(K){
        K.off && K.off("wsMessage", onWs);
        try { if (wrap?.parentNode) wrap.parentNode.removeChild(wrap); } catch {}
        try { if (styleEl?.parentNode) styleEl.parentNode.removeChild(styleEl); } catch {}
        mounted = false; wrap = null; styleEl = null; cooldown.clear(); q.length = 0; running = false;
      }
    };
  }
  function register(){ if (!window.KQuiz?.registerAddon) return setTimeout(register, 100); window.KQuiz.registerAddon(factory()); }
  register();
})();
