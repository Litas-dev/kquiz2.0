/* addons/adon.js
   ID Stabilizer v1.9 — SAFE canon + offline simulator + STRICT single-symbol parser (NO live lock)
   Scope:
     - Stabilizes user IDs across mixed sources using SAFE canon:
         canon = strong(secUid) || strong(uniqueId) || strong(userId) || anon:<hash8(name|avatar)>
       where weak placeholders ("user","unknown","-","0","null","undefined","") are ignored.
     - Provides offline self-test + offline round simulator (no DevTools)
     - STRICT parsing: only exact single-symbol A/B/C/D or 1/2/3/4 (incl. emoji/fullwidth/regional) count as answers
     - DOES NOT write live answers; SOLO logic untouched
*/
(function(){
  const ADDON_ID = "idStabilizer";
  const lc = v => v==null ? "" : String(v).toLowerCase();
  const WEAK = new Set(["", "user", "unknown", "-", "0", "null", "undefined"]);
  const strong = v => { const s = lc(v); return (s && !WEAK.has(s)) ? s : ""; };

  // 8-char non-crypto hash to avoid anon collisions
  function hash8(s){
    let h1 = 0x811c9dc5, h2 = 0x45d9f3b;
    for (let i=0;i<s.length;i++){
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619);
      h2 ^= c + ((h2<<6) + (h2>>>2));
    }
    const x = (h1>>>0).toString(36) + (h2>>>0).toString(36);
    return x.slice(0,8);
  }

  // ---------------- SAFE CANONICALIZATION ----------------
  function rawIds(m){
    const u = m?.user || {};
    return {
      sec: u.secUid??m.secUid??"",
      unq: u.uniqueId??m.uniqueId??"",
      uid: m.userId??u.userId??m.uid??"",
      name: m.displayName||m.nickname||u.nickname||u.uniqueId||m.uniqueId||"",
      ava:  u.profilePictureUrl||u.profilePicture||m.profilePictureUrl||m.profilePicture||""
    };
  }
  function decideCanon(ids){
    return strong(ids.sec) || strong(ids.unq) || strong(ids.uid) ||
           `anon:${hash8((ids.name||"")+"|"+(ids.ava||""))}`;
  }
  function patchMessage(m){
    const ids = rawIds(m);
    const canon = decideCanon(ids);
    // write-through normalized ID, never merge different strong IDs
    m.userId = canon;
    m.user = m.user || {};
    m.user.userId = canon;
    if (strong(ids.sec)) m.user.secUid = ids.sec;
    if (strong(ids.unq)) m.user.uniqueId = ids.unq;
    return m;
  }

  // ---------------- OFFLINE LOCKER (sim only; never live) ----------------
  function lockFirstAnswer(K, msg){
    if (!K.state.session) K.state.session = {};
    const S = K.state.session;
    if (!S.answers) S.answers = {};
    const ensured = (K.util?.ensurePlayer ? K.util.ensurePlayer(msg) : { id: msg.userId });
    const id = ensured && ensured.id ? ensured.id : msg.userId;
    if (id && S.answers[id] == null){
      S.answers[id] = { text: String(msg.text||""), ts: Date.now() };
    }
  }

  // ---------------- SETTINGS UI ----------------
  function mountUI(){
    const grid = document.querySelector("#settings .grid2");
    if (!grid || document.getElementById("idStabCard")) return null;
    const card = document.createElement("div");
    card.className = "card"; card.id = "idStabCard";
    card.innerHTML = `
      <h3 style="margin:0 0 8px">ID stabilizatorius</h3>
      <div class="muted" style="margin:0 8px 8px 0">
        SAFE canon: <code>secUid→uniqueId→userId→anon:hash8(name|avatar)</code>. Ignoruoja silpnus ID. Live atsakymų neliečia.
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0">
        <button class="btn" id="idStabTest">Greitas testas</button>
        <button class="btn" id="idStabSim">Simuliuoti raundą offline</button>
        <button class="btn alt" id="idStabHudToggle">Perjungti HUD</button>
      </div>
      <div id="idStabStatus" class="muted">Paruošta.</div>
      <div id="idStabHud" style="display:none;margin-top:8px;font-family:monospace;white-space:pre-wrap"></div>
    `;
    grid.appendChild(card); return card;
  }

  function factory(){
    let off=null, hud=false; const log=[];
    const push = s=>{ log.push(s); if(log.length>14) log.shift();
      const box=document.getElementById("idStabHud"); if(box&&hud) box.textContent=log.join("\n"); };

    // Offline sender for simulator
    function send(K, raw){
      const evt = Object.assign({ type:"chat", text: raw.text||"" }, raw);
      patchMessage(evt);
      lockFirstAnswer(K, evt);      // offline path only
      K.emit("wsMessage", evt);     // let other add-ons observe
      if (hud){
        const ids = rawIds(evt);
        push(\`msg:"\${evt.text}" sec=\${ids.sec||"-"} unq=\${ids.unq||"-"} uid=\${evt.userId}\`);
      }
    }
    function beginOfflineRound(K){
      if (!K.state.session) K.state.session = {};
      K.state.session.answers = {};
      K.state.session.round = (K.state.session.round||0)+1;
      K.state.session.accepting = true;
    }
    function runSimulator(K){
      beginOfflineRound(K);

      const sameA = { text:"A", user:{ secUid:"SEC#123", uniqueId:"nick1", userId:999 }, displayName:"Nick" };
      const sameB = { text:"B", user:{ uniqueId:"nick1" }, displayName:"Nick" };
      const sameC = { text:"C", userId:999, displayName:"Nick" };
      const p2 = { text:"A", user:{ secUid:"SEC#X" }, displayName:"X" };
      const p3 = { text:"B", user:{ uniqueId:"y_user" }, displayName:"Y" };
      const weak = { text:"A", user:{ userId:"user" }, displayName:"Anon", profilePicture:"" };

      [sameA, sameB, sameC, p2, p3, weak].forEach(m => send(K, m));

      const answers = K.state.session.answers || {};
      const keys = Object.keys(answers);
      const status = document.getElementById("idStabStatus");
      const nickCanon = patchMessage({user:{secUid:"SEC#123",uniqueId:"nick1",userId:999}}).userId;
      const passNick = !!answers[nickCanon];
      const weakCanon = patchMessage(weak).userId;
      const weakUnique = !/^(user|unknown|-|0|null|undefined)$/.test(weakCanon);
      status.textContent = (passNick && weakUnique)
        ? \`SIM: OK. Nick→\${nickCanon}. Silpnas→\${weakCanon}. Atsakymai: \${keys.length}.\`
        : \`SIM: KLAIDA. Raktai: [\${keys.join(", ")}].\`;
    }

    return {
      id: ADDON_ID,
      name: "ID Stabilizer",
      description: "SAFE canon. Stabilizuoja ID. Offline simuliatorius. Be live užrakto.",
      defaultEnabled: true,
      enable(K){
        const card = mountUI(); const status = card?.querySelector("#idStabStatus");

        // Live path: ONLY normalize frames, never touch answers
        const onWS = (evt)=>{ try{
          if (evt?.type==="chat" && evt.raw) patchMessage(evt.raw);
          if (evt?.type==="chat"){ patchMessage(evt);
            if (hud){
              const ids = rawIds(evt);
              push(\`msg:"\${evt.text||""}" sec=\${ids.sec||"-"} unq=\${ids.unq||"-"} uid=\${evt.userId}\`);
            }
          }
        }catch{} };
        K.on("wsMessage", onWS);

        // Shim ensurePlayer safely
        const util = K.util || (K.util = {}); const prevEnsure = util.ensurePlayer;
        util.ensurePlayer = function(msg){
          const m = patchMessage(msg||{});
          if (prevEnsure) return prevEnsure.call(this, m);
          const id = m.userId;
          const name = m.displayName || m.nickname || m.user?.nickname || m.user?.uniqueId || m.uniqueId || id;
          const p = (K.state.players[id] ||= { name, score:0, nextMilestone:100, avatar:"" });
          return { id, p };
        };

        // UI wires
        if (card){
          card.querySelector("#idStabHudToggle").onclick = ()=>{
            hud = !hud; const box=card.querySelector("#idStabHud");
            box.style.display = hud ? "block" : "none";
            if (status) status.textContent = hud ? "HUD: įjungta." : "HUD: išjungta.";
          };
          card.querySelector("#idStabTest").onclick = ()=>{
            const A = { type:"chat", text:"A", user:{ secUid:"SEC#123", uniqueId:"nick1", userId:999 } };
            const B = { type:"chat", text:"B", user:{ uniqueId:"nick1" } };
            const C = { type:"chat", text:"C", userId:999 };
            [A,B,C].forEach(patchMessage);
            const ids = [A,B,C].map(m=>m.userId);
            const ok = ids.every(x=>x===ids[0]);
            if (status) status.textContent = ok ? \`TESTAS: OK. → \${ids[0]}\` : \`TESTAS: KLAIDA. \${ids.join(" | ")}\`;
          };
          card.querySelector("#idStabSim").onclick = ()=> runSimulator(K);
        }

        off = ()=>{ try{ K.off("wsMessage", onWS); }catch{} util.ensurePlayer = prevEnsure; };
        if (status) status.textContent = "Aktyvuota. SAFE canon veikia. Live atsakymų neliečia.";
      },
      disable(){ try{ off&&off(); }catch{} }
    };
  }

  function register(){ if(!window.KQuiz?.registerAddon) return setTimeout(register,120); window.KQuiz.registerAddon(factory()); }
  register();
})();

/* ---------------- STRICT SINGLE-SYMBOL ANSWER PARSER PATCH ----------------
   Accepts only: A/B/C/D or 1/2/3/4 as ONE symbol.
   Also recognizes emoji keycaps 1️⃣–4️⃣, circled ①–④, fullwidth １–４ and Ａ–Ｄ,
   and regional indicators 🇦–🇩 / 🅰️ 🅱️. Any multi-char message is ignored.
*/
(function(){
  const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g; // zero-width and BOM
  const VARIATION  = /\uFE0F/g;                // emoji VS16

  const mapKeycap  = { "1️⃣":"1","2️⃣":"2","3️⃣":"3","4️⃣":"4" };
  const mapCircled = { "①":"1","②":"2","③":"3","④":"4" };
  const mapFullw   = { "１":"1","２":"2","３":"3","４":"4","Ａ":"A","Ｂ":"B","Ｃ":"C","Ｄ":"D" };
  const REGIONAL   = { "🇦":"A","🇧":"B","🇨":"C","🇩":"D","🅰️":"A","🅱️":"B" };

  function normalizeStrict(t){
    let s = String(t||"").normalize("NFKC");
    s = s.replace(ZERO_WIDTH,"").replace(VARIATION,"").trim();
    s = s.split("").map(ch => mapKeycap[ch] || mapCircled[ch] || mapFullw[ch] || REGIONAL[ch] || ch).join("");
    return s.trim();
  }

  function strictParse(text){
    const s = normalizeStrict(text).toUpperCase();
    if (s.length !== 1) return null;           // only single visible symbol counts
    if ("ABCD".includes(s)) return s;          // letters
    if ("1234".includes(s)) return ({ "1":"A","2":"B","3":"C","4":"D" })[s]; // numbers → letters
    return null;
  }

  function install(K){
    const util = K.util || (K.util = {});
    const prev = util.parseAnswer;
    util.parseAnswer = function(txt){
      const r = strictParse(txt);
      return r || (prev ? prev.call(this, txt) : null);
    };
    // Optional hint: attach parsed key to inbound chat frames
    K.on && K.on("wsMessage", (evt)=>{ try{
      if (evt && evt.type === "chat"){
        const key = strictParse(evt.text);
        if (key) evt.parsed = key;
      }
    }catch{} });
  }

  (function wait(){ if (!window.KQuiz) return setTimeout(wait,120); install(window.KQuiz); })();
})();