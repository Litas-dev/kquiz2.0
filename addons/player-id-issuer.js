/* addons/player-id-issuer.js
   Player ID Issuer v1.0 — visible short IDs + hard lock to canonical user
   - Assigns a short ID (PID) on first sight
   - Users can type "!id" to see theirs
   - Enforces aliasing so future frames resolve to same game key
   - No answer parsing or locking here; core/solo keep that
*/
(function(){
  function factory(){
    const pidByCanon = new Map();   // canonId -> PID
    const canonByAny = new Map();   // any seen id -> canonId
    const recent = [];              // recent assigned for UI

    // small, readable IDs
    const ALPH = "23456789abcdefghjkmnpqrstuvwxyz"; // no lookalikes
    function mkPID(n=4){
      let s=""; for(let i=0;i<n;i++) s += ALPH[Math.floor(Math.random()*ALPH.length)];
      return s;
    }

    const lc = v => v==null ? null : String(v).toLowerCase();
    function rawIds(m){
      const u = m?.user || {};
      return { sec: u.secUid ?? m.secUid ?? null,
               unq: u.uniqueId ?? m.uniqueId ?? null,
               uid: m.userId ?? u.userId ?? m.uid ?? null };
    }
    function decideCanon(ids){
      return lc(ids.sec) || lc(ids.unq) || lc(ids.uid) || "user";
    }
    function learn(ids, canon){
      [lc(ids.sec), lc(ids.unq), lc(ids.uid)].filter(Boolean).forEach(k=>canonByAny.set(k, canon));
    }
    function canonId(m){
      const ids = rawIds(m);
      const known = [lc(ids.sec),lc(ids.unq),lc(ids.uid)].map(x=>canonByAny.get(x)).find(Boolean);
      const canon = known || decideCanon(ids);
      learn(ids, canon);
      return canon;
    }

    // Settings UI
    function mountUI(){
      const grid = document.querySelector('#settings .grid2');
      if (!grid || document.getElementById('pidCard')) return null;
      const card = document.createElement('div');
      card.className = 'card'; card.id = 'pidCard';
      card.innerHTML = `
        <h3 style="margin:0 0 8px">Žaidėjų ID (PID)</h3>
        <div class="muted" style="margin-bottom:8px">Kiekvienam žaidėjui priskiriamas trumpas ID. Komanda: <code>!id</code>.</div>
        <div id="pidList" style="font-family:monospace;white-space:pre-wrap;max-height:260px;overflow:auto;border:1px solid #1E2A3F;border-radius:12px;padding:8px;background:rgba(16,24,40,.4)"></div>
      `;
      grid.appendChild(card);
      return card.querySelector('#pidList');
    }
    function pushRecent(box, pid, name, canon){
      recent.unshift(`${pid}  | ${name}  (${canon})`);
      while (recent.length>60) recent.pop();
      if (box) box.textContent = recent.join('\n');
    }

    let off=null;

    return {
      id: "playerIdIssuer",
      name: "Player ID Issuer",
      description: "Suteikia matomą žaidėjo ID ir pririša žinutes prie to paties vartotojo.",
      defaultEnabled: true,
      enable(K){
        const box = mountUI();

        // Normalize inbound frames, assign PID, expose it, and re-tag message with canon+PID
        const onChat = (m)=>{
          if (!m || m.type !== 'chat') return;

          // establish canon id
          const canon = canonId(m);

          // assign PID once
          let pid = pidByCanon.get(canon);
          if (!pid){ pid = mkPID(); pidByCanon.set(canon, pid);
            const name = m.displayName || m.user?.nickname || canon;
            pushRecent(box, pid, name, canon);
          }

          // write-through so downstream sees consistent identity + pid
          m.userId = canon;
          m.user = m.user || {};
          m.user.userId = canon;
          m.user.pid = pid;          // expose PID under user
          m.pid = pid;               // top-level convenience

          // respond to "!id" locally (read-only; does not affect answers)
          const txt = String(m.text||"").trim();
          if (txt.toLowerCase() === '!id'){
            try {
              K.emit('systemMessage', { text: `${m.displayName||'Žaidėjas'}: tavo ID ${pid}` });
            } catch {}
          }
        };

        K.on('wsMessage', onChat);
        off = ()=>{ try{ K.off('wsMessage', onChat); }catch{} };
      },
      disable(){ try{ off && off(); }catch{} }
    };
  }
  function register(){ if (!window.KQuiz?.registerAddon) return setTimeout(register, 120); window.KQuiz.registerAddon(factory()); }
  register();
})();
