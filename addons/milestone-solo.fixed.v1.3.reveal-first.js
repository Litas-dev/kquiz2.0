/* === BUNDLED: milestone-solo.js + patch v1 === */

/* KQuiz addon: Milestone Solo Challenge v1.8
   - Auto-queue on 100/200/300…
   - Pauses main game while SOLO queue drains
   - Shows correct answer after user answers (REVEAL_MS), then proceeds
   - Hard timer reset per SOLO
   - Bonus sound on popup (assets/audio/game-bonus.mp3)
   - SOLO-SAFE: ignores score spikes during duel transfers
*/
(function () {
  function factory() {
    // ---- state ----
    let queue = [];                 // FIFO of player IDs awaiting SOLO
    let running = false;            // SOLO active
    let targetId = null;            // current SOLO player id
    let stage = "idle";             // 'idle' | 'intro' | 'question'
    let t = null, left = 0, total = 0;
    let overlay = null, styleEl = null, mounted = false;
    let guardActive = false;
    let curQ = null;
    let startTimer = null;
    let vipSuppressed = false;
    const VIP_TOKEN = "milestone-solo";
    function setVipSuppressed(on) {
      if (on) {
        if (!vipSuppressed) {
          try { window.KQuiz?.control?.suppressVip?.(VIP_TOKEN); } catch {}
          vipSuppressed = true;
        }
      } else if (vipSuppressed) {
        try { window.KQuiz?.control?.releaseVip?.(VIP_TOKEN); } catch {}
        vipSuppressed = false;
      }
    }
    // --- Live flags (LT) + async question builder (non-breaking) ---
    const _FLAG_POOL = []; // {qid,nameLT,flagURL}
    let _flagLoadInFlight = null;
    function _shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; [a[i],a[j]]=[a[j],a[i]]; } return a; }
    async function _loadFlagsLT(){
      if(_FLAG_POOL.length) return;
      if(_flagLoadInFlight) return _flagLoadInFlight;
      _flagLoadInFlight = (async()=>{
        const q = `SELECT ?c ?cLabel ?flag WHERE {
          ?c wdt:P31 wd:Q6256; wdt:P41 ?flag.
          SERVICE wikibase:label { bd:serviceParam wikibase:language "lt,en". }
        }`;
        const url = "https://query.wikidata.org/sparql?format=json&query="+encodeURIComponent(q);
        try{
          const ctrl = new AbortController(); const to = setTimeout(()=>ctrl.abort(), 5000);
          const r = await fetch(url,{headers:{Accept:"application/sparql-results+json"}, signal: ctrl.signal});
          clearTimeout(to);
          const rows = (await r.json())?.results?.bindings || [];
          rows.forEach(m=>{
            const qid = (m.c?.value||"").split("/").pop();
            const nameLT = m.cLabel?.value || "";
            let flag = m.flag?.value || "";
            if(flag && !flag.includes("Special:FilePath")){
              const fname = decodeURIComponent(flag.split("/").pop());
              flag = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fname)}?width=640`;
            }else if(flag){ flag += (flag.includes("?")?"&":"?")+"width=640"; }
            if(qid && nameLT && flag) _FLAG_POOL.push({qid, nameLT, flagURL: flag});
          });
        }catch(e){
          // Fallback minimal set
          const fb = [
            { qid:"Q37",  nameLT:"Lietuva",            flagURL:"https://commons.wikimedia.org/wiki/Special:FilePath/Flag%20of%20Lithuania.svg?width=640" },
            { qid:"Q36",  nameLT:"Lenkija",            flagURL:"https://commons.wikimedia.org/wiki/Special:FilePath/Flag%20of%20Poland.svg?width=640" },
            { qid:"Q38",  nameLT:"Italija",            flagURL:"https://commons.wikimedia.org/wiki/Special:FilePath/Flag%20of%20Italy.svg?width=640" },
            { qid:"Q142", nameLT:"Prancūzija",         flagURL:"https://commons.wikimedia.org/wiki/Special:FilePath/Flag%20of%20France.svg?width=640" },
            { qid:"Q183", nameLT:"Vokietija",          flagURL:"https://commons.wikimedia.org/wiki/Special:FilePath/Flag%20of%20Germany.svg?width=640" },
            { qid:"Q145", nameLT:"Jungtinė Karalystė", flagURL:"https://commons.wikimedia.org/wiki/Special:FilePath/Flag%20of%20the%20United%20Kingdom.svg?width=640" },
          ];
          _FLAG_POOL.push(...fb);
        } finally {
          _flagLoadInFlight = null;
        }
      })();
      return _flagLoadInFlight;
    }
    function _pickFlagQuestion(){
      if(!_FLAG_POOL.length) return null;
      const seed = _FLAG_POOL[(Math.random()*_FLAG_POOL.length)|0];
      const correct = seed.nameLT;
      const pool = _shuffle(_FLAG_POOL.filter(x=>x.nameLT!==correct)).slice(0,16);
      const distract=[], used=new Set([correct]);
      for(const it of pool){ if(!used.has(it.nameLT)){ distract.push(it.nameLT); used.add(it.nameLT); if(distract.length===3) break; } }
      while(distract.length<3) distract.push("Nežinoma šalis");
      const opts = _shuffle([correct, ...distract]);
      const keys = ["A","B","C","D"];
      const correctKey = keys[opts.indexOf(correct)] || "A";
      return {
        qid: null,
        q: "Kuri tai šalis?",
        html: `<div style="display:flex;flex-direction:column;align-items:center;gap:8px"><div style="font-weight:900">Kuri tai šalis?</div><img alt="vėliava" src="${seed.flagURL}" style="max-width:min(88vw,720px);width:100%;border-radius:12px;border:1px solid #1E2A3F"/></div>`,
        options: opts,
        keys,
        correctKey,
        correctText: correct,
        note: "Šaltinis: Wikidata P41 / Commons"
      };
    }
    function buildFlagsOrFallback(K){
      return _loadFlagsLT().then(()=>_pickFlagQuestion()).catch(()=>null).then(q=>{
        if(q) return q;
        const fb = getRandomUnusedQuestion(K) || K.control.getRandomQuestion() || {
          q: "Klausimas",
          options: ["Atsakymas A","Atsakymas B","Atsakymas C","Atsakymas D"],
          keys: ["A","B","C","D"],
          correctKey: "A",
          correctText: "Atsakymas A"
        };
        return fb;
      });
    }
    function beginQuestion(K, q){
      curQ = q;
      document.getElementById("kqSoloIntro").classList.add("kq-hide");
      document.getElementById("kqSoloPlay").classList.remove("kq-hide");
      resetVisuals();

      const qEl = document.getElementById("kqSoloQ");
      const box = document.getElementById("kqSoloAns");
      const fill = document.getElementById("kqSoloFill");
      const leftEl = document.getElementById("kqSoloLeft");
      const cancelBtn = document.getElementById("kqSoloCancel2");
      const resumeBtn = document.getElementById("kqSoloResume");
      if (resumeBtn) { resumeBtn.classList.add("kq-hide"); resumeBtn.onclick = null; }

      if (q.html) { qEl.innerHTML = q.html; } else { qEl.textContent = q.q; }
      box.innerHTML = "";
      q.options.forEach((opt, i) => {
        const key = q.keys[i];
        const node = K.util.el("div", { class: "kq-choice", "data-key": key },
          K.util.el("div", { class: "kq-key" }, key), opt);
        box.appendChild(node);
      });

      if (!guardActive) {
        K.control.setChatGuard((msg, { parseAnswer, ensurePlayer }) => {
          if (stage !== "question") return true;
          const { id: uid } = ensurePlayer(msg);
          if (uid !== targetId) return true;
          const key = parseAnswer(String(msg.text || ""));
          if (!key) return true;
          resolve(K, key === q.correctKey);
          return true;
        });
        guardActive = true;
      }

      try {
        if (K.state.settings?.sounds?.ticking) {
          const a = document.getElementById("tickAudio");
          if (a) { a.currentTime = 0; a.play(); }
        }
      } catch {}

      // timer
      if (t) { clearInterval(t); t = null; }
      const SOLO_SECS = Number(K?.state?.settings?.soloSeconds || 30);
      left = SOLO_SECS; total = left;
      leftEl.textContent = String(left);
      fill.style.width = "0%";

      t = setInterval(() => {
        left--;
        leftEl.textContent = String(Math.max(0, left));
        fill.style.width = (total ? (100 * (total - left) / total) : 0) + "%";
        if (left <= 0) { clearInterval(t); t = null; resolve(K, false); }
      }, 1000);

      cancelBtn.onclick = () => resolve(K, false);
    }


    // Config
    const STEP = 100;               // milestones: 100, 200, 300...
    const REVEAL_MS = 2500;
    const START_HOLD_MS = 2000;   // delay start so main can reveal correct answer
    const QUEUE_BREAK_MS = 600;   // small gap between queued SOLOs         // how long to show the correct answer before moving on

    // Tracking
    const seenMilestone = new Map(); // id -> last reached multiple (1=100,2=200,...)
    const lastScore = new Map();     // id -> last seen score (for spike detection)

    // ---- UI mount/unmount ----
    function mountUI() {
      if (mounted) return;
      const css = `
.kq-solo-overlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:99;padding:16px;background:rgba(3,8,18,.65);backdrop-filter:blur(3px)}
.kq-solo-card{width:min(900px,96vw);background:rgba(16,24,40,.55);border:1px solid #1E2A3F;border-radius:20px;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,.25)}
.kq-row{display:flex;align-items:center;gap:8px}
.kq-av{width:64px;height:64px;border-radius:50%;object-fit:cover;border:1px solid #1E2A3F}
.kq-name{font-weight:900;font-size:clamp(18px,3.4vw,24px)}
.kq-badge{font-size:12px;color:#9FB0C6}
.kq-q{text-align:center;font-weight:900;line-height:1.25;font-size:clamp(22px,4.6vw,36px);margin:10px 0}
.kq-ans{width:100%;max-width:900px;display:grid;gap:12px;grid-template-columns:1fr}
@media (min-width:720px){.kq-ans{grid-template-columns:1fr 1fr}}
.kq-choice{display:flex;align-items:center;gap:12px;padding:16px 14px;border-radius:18px;border:1px solid #1E2A3F;background:rgba(17,27,47,.75);font-weight:800;font-size:clamp(18px,3.6vw,28px)}
.kq-choice.is-correct{outline:3px solid #2EE5A9}
.kq-choice.is-dim{filter:grayscale(.35) opacity(.85)}
.kq-key{min-width:56px;height:44px;display:inline-flex;align-items:center;justify-content:center;border-radius:14px;background:#0E1730;border:1px solid #26365A;color:#BBD7FF;font-weight:900}
.kq-bar{height:14px;border-radius:999px;background:#11213A;border:1px solid #1E2A3F;overflow:hidden;margin-top:6px}
.kq-fill{height:100%;width:0%;background:linear-gradient(90deg,#7C5CFF,#2EE5A9)}
.kq-ctrls{display:flex;gap:10px;justify-content:center;margin-top:12px;flex-wrap:wrap}
.kq-btn{padding:10px 14px;border-radius:14px;border:1px solid #1E2A3F;background:#0E162B;color:#F3F6FC;font-weight:900;cursor:pointer}
.kq-hide{display:none}
.kq-result{margin-top:10px;text-align:center;font-weight:900;font-size:clamp(16px,3vw,22px)}
.kq-result.ok{color:#2EE5A9}
.kq-result.bad{color:#FF5A6E}
`;
      styleEl = document.createElement("style");
      styleEl.textContent = css;
      document.head.appendChild(styleEl);

      // Bonus sound element (file lives next to index.html)
      if (!document.getElementById("bonusAudio")) {
        const a = document.createElement("audio");
        a.id = "bonusAudio";
        try {
          a.src = window.KQ_ASSETS?.audio ? window.KQ_ASSETS.audio("game-bonus.mp3") : "assets/audio/game-bonus.mp3";
        } catch {
          a.src = "assets/audio/game-bonus.mp3";
        }
        a.preload = "auto";
        a.volume = 1.0;
        document.body.appendChild(a);
      }

      overlay = document.createElement("div");
      overlay.className = "kq-solo-overlay";
      overlay.innerHTML = `
        <div class="kq-solo-card">
          <!-- INTRO -->
          <div id="kqSoloIntro">
            <div class="kq-row" style="justify-content:center;gap:12px;margin-bottom:8px">
              <img class="kq-av" id="kqSoloAva" alt="">
              <div>
                <div class="kq-name" id="kqSoloName">Žaidėjas</div>
                <div class="kq-badge">Asmeninis iššūkis</div>
              </div>
            </div>
            <div class="kq-ctrls">
              <button class="kq-btn" id="kqSoloGo">Toliau</button>
              <button class="kq-btn" id="kqSoloCancel1">Atšaukti</button>
            </div>
          </div>

          <!-- QUESTION -->
          <div id="kqSoloPlay" class="kq-hide">
            <div class="kq-q" id="kqSoloQ">Klausimas...</div>
            <div class="kq-bar"><div class="kq-fill" id="kqSoloFill"></div></div>
            <div class="kq-row" style="justify-content:space-between;color:#9FB0C6;font-weight:700;margin:4px 2px">
              <div>Laikas: <span id="kqSoloLeft">0</span>s</div>
              <div>Riba: +10 / -20%</div>
            </div>
            <div class="kq-ans" id="kqSoloAns"></div>
            <div id="kqSoloResult" class="kq-result kq-hide"></div>
            <div class="kq-ctrls">
              <button class="kq-btn" id="kqSoloCancel2">Atšaukti</button>
              <button class="kq-btn kq-hide" id="kqSoloResume">Tęsti žaidimą</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      mounted = true;
    }

    function unmountUI() {
      setVipSuppressed(false);
      try { if (overlay?.parentNode) overlay.parentNode.removeChild(overlay); } catch {}
      try { if (styleEl?.parentNode) styleEl.parentNode.removeChild(styleEl); } catch {}
      overlay = null; styleEl = null; mounted = false;
    }


    // question picker that respects main game's 'used' ledger
    function buildSoloQuestionFromBank(K, qid){
      try{
        const q = (K?.state?.bank || [])[qid];
        if(!q) return null;
        const opts = [q.correct, ...(q.wrong||[])].slice(0,4);
        while(opts.length<4) opts.push("");
        const ord = [0,1,2,3]; for(let i=ord.length-1;i>0;i--){ const j=(Math.random()* (i+1))|0; const t=ord[i]; ord[i]=ord[j]; ord[j]=t; }
        const keys = ["A","B","C","D"];
        const key = keys[ord.indexOf(0)] || "A";
        return {
          qid,
          q: q.q || q.question || "",
          options: ord.map(i=>opts[i]),
          keys,
          correctKey: key,
          correctText: q.correct || "",
          note: q.note || ""
        };
      }catch(e){ return null; }
    }
    function getRandomUnusedQuestion(K){
      const bank = K?.state?.bank || [];
      const used = K?.state?.session?.used || {};
      const deck = K?.state?.session?.deck;
      let candidates = [];
      if(Array.isArray(deck) && deck.length){
        for(let i=0;i<deck.length;i++){
          const id = deck[i];
          if(!used[id]) candidates.push(id);
        }
      } else {
        for(let i=0;i<bank.length;i++){
          if(!used[i]) candidates.push(i);
        }
      }
      if(!candidates.length) return null;
      const qid = candidates[(Math.random()*candidates.length)|0];
      return buildSoloQuestionFromBank(K, qid);
    }
// ---- helpers ----
    function resetVisuals() {
      try {
        const fill = document.getElementById("kqSoloFill"); if (fill) fill.style.width = "0%";
        const leftEl = document.getElementById("kqSoloLeft"); if (leftEl) leftEl.textContent = "0";
        const res = document.getElementById("kqSoloResult"); if (res) { res.classList.add("kq-hide"); res.classList.remove("ok","bad"); res.textContent = ""; }
        const nodes = document.querySelectorAll("#kqSoloAns .kq-choice");
        nodes.forEach(n => n.classList.remove("is-correct","is-dim"));
      } catch {}
    }
    function stopTick() { try { const a = document.getElementById("tickAudio"); if (a) a.pause(); } catch {} }
    function playFail() { try { const f = document.getElementById("failAudio"); if (f) { f.currentTime = 0; f.play(); } } catch {} }
    function playBonus() { try { const a = document.getElementById("bonusAudio"); if (a) { a.currentTime = 0; a.play(); } } catch {} }

    function highlightCorrect() {
      if (!curQ) return;
      try {
        const nodes = Array.from(document.querySelectorAll("#kqSoloAns .kq-choice"));
        nodes.forEach(n => {
          const k = (n.getAttribute("data-key") || "").trim();
          if (k === curQ.correctKey) n.classList.add("is-correct");
          else n.classList.add("is-dim");
        });
      } catch {}
    }

    // ---- queue API ----
    function enqueue(id) {
      const pid = String(id || "").toLowerCase();
      if (!pid) return;
      if (!queue.includes(pid)) queue.push(pid);
      const K = window.KQuiz;
      if (!running && K?.control?.pauseMain) K.control.pauseMain();
      if (startTimer) try{ clearTimeout(startTimer); }catch{}
      startTimer = setTimeout(()=>{ kick(window.KQuiz); startTimer = null; }, START_HOLD_MS || 0);
    }
    function kick(K) {
      if (!running && queue.length > 0) runIntro(K, queue.shift());
    }

    // ---- stages ----
    function runIntro(K, id) {
      running = true;
      targetId = id;
      stage = "intro";

      K.control.pauseMain();
      mountUI(); resetVisuals();

      const p = K.state.players[id] || {};
      document.getElementById("kqSoloName").textContent = p.name || id;
      document.getElementById("kqSoloAva").src = p.avatar || "";

      document.getElementById("kqSoloIntro").classList.remove("kq-hide");
      document.getElementById("kqSoloPlay").classList.add("kq-hide");
      overlay.style.display = "flex";
      setVipSuppressed(true);

      playBonus();

      document.getElementById("kqSoloGo").onclick = () => startQuestion(K);
      document.getElementById("kqSoloCancel1").onclick = () => resolve(K, false);
    }

    function startQuestion(K) {
      if (stage !== "intro") return;
      stage = "question";
      // Build a flags question first; fallback to your bank without changing control flow
      buildFlagsOrFallback(K).then(q => {
        beginQuestion(K, q);
      }).catch(() => {
        const q = getRandomUnusedQuestion(K) || K.control.getRandomQuestion() || {
          q: "Klausimas",
          options: ["Atsakymas A","Atsakymas B","Atsakymas C","Atsakymas D"],
          keys: ["A","B","C","D"],
          correctKey: "A",
          correctText: "Atsakymas A"
        };
        beginQuestion(K, q);
      });
    }

    function resolve(K, ok) {
      if (t) { clearInterval(t); t = null; }
      try { const a = document.getElementById("tickAudio"); if (a) a.pause(); } catch {}

      // score update
      // mark this question as used in main ledger
      try { if (curQ && curQ.qid != null) K.state.session.used[curQ.qid] = true; } catch {}
      // score update
      const p = K.state.players[targetId];
      if (p) p.score = ok ? (p.score || 0) + 10 : Math.floor((p.score || 0) * 0.8);

      // show result + correct answer
      if (curQ) {
        const res = document.getElementById("kqSoloResult");
        if (res) {
          res.classList.remove("kq-hide");
          res.classList.toggle("ok", !!ok);
          res.classList.toggle("bad", !ok);
          res.textContent = ok
            ? `Teisinga! +10 (${curQ.correctText})`
            : `Neteisinga. −20% | Teisingas: ${curQ.correctText}`;
        }
        highlightCorrect();
      }
      if (!ok) playFail();

      if (guardActive) { try { K.control.clearChatGuard(); } catch {} guardActive = false; }

      // keep overlay visible while revealing, keep main paused
      const hasNext = queue.length > 0;
      setTimeout(() => {
        if (hasNext) {
          resetVisuals();
          stage = "idle"; running = false; targetId = null; curQ = null;
          overlay.style.display = "flex";
          setTimeout(()=>{ kick(K); }, QUEUE_BREAK_MS||0);  // brief gap before next SOLO
        } else {
          resetVisuals();
          overlay.style.display = "none";
          stage = "idle"; running = false; targetId = null; curQ = null;
          setVipSuppressed(false);
          K.control.resumeMain();        // resume only when queue is empty
        }
      }, REVEAL_MS);
    }

    // ---- milestone monitor ----
    function duelSuppressed(K) {
      // Duel addon sets K.state.__soloSuppressUntil = Date.now()+N
      return (K?.state?.__soloSuppressUntil || 0) > Date.now();
    }

    function scanMilestones(K){
      const players = K?.state?.players || {};
      for (const [id, p] of Object.entries(players)) {
        const s = Number(p?.score || 0);
        const prevScore = lastScore.has(id) ? lastScore.get(id) : s;
        lastScore.set(id, s);

        if (s < STEP) { seenMilestone.set(id, 0); continue; }
        const k = Math.floor(s / STEP);          // 1=100, 2=200, ...
        const prevK = seenMilestone.get(id) || 0;

        if (k <= prevK) continue;

        // SOLO-SAFE handling:
        // If a duel suppression window is active AND the jump looks like a transfer spike,
        // swallow all milestones up to current k (no enqueue), so duel points never trigger solo later.
        if (duelSuppressed(K) && (s - prevScore) >= Math.ceil(STEP * 0.5)) {
          seenMilestone.set(id, k);    // mark as seen without enqueue
          continue;
        }

        // normal path: enqueue and mark
        seenMilestone.set(id, k);
        enqueue(id);
      }
    }

    let scanTimer = null;

    // ---- addon interface ----
    return {
      id: "milestoneSolo",
      name: "Milestone Solo",
      description: "SOLO iššūkis su atskleidimu po atsakymo ir eile. Ignoruoja dvikovų taškų šuolius.",
      defaultEnabled: true,
      enable(K) {
        // seed trackers
        const players=K?.state?.players||{};
        for (const [id, p] of Object.entries(players)) {
          const s = Number(p?.score || 0);
          lastScore.set(id, s);
          seenMilestone.set(id, Math.floor(s / STEP));
        }

        if (!scanTimer) scanTimer = setInterval(() => scanMilestones(K), 400);
        K.on && K.on("milestoneHit", ({ id }) => { enqueue(id); });

        // expose enqueueSolo hook for other addons (kept)
        if (!K.control) K.control = {};
        const prev = K.control.enqueueSolo;
        K.control.enqueueSolo = function(id){
          enqueue(id);
          if (typeof prev === "function") try { prev.call(this, id); } catch {}
        };
      },
      disable() {
        try { if (t) clearInterval(t); } catch {}
        try { if (scanTimer) clearInterval(scanTimer); } catch {}
        scanTimer = null;
        try { if (guardActive) window.KQuiz?.control?.clearChatGuard(); } catch {}
        resetVisuals(); unmountUI();
        queue = []; running = false; targetId = null; stage = "idle"; curQ = null; guardActive = false;
        seenMilestone.clear(); lastScore.clear();
      }
    };
  }

  function register() {
    if (!window.KQuiz?.registerAddon) return setTimeout(register, 120);
    window.KQuiz.registerAddon(factory());
  }
  register();
})();


/*!
 * KQuiz add-on patch: milestone-solo flag fixes (v1.0.0)
 * Purpose:
 *   - Exclude UN/expired flags
 *   - Guarantee the correct option is always among A–D
 * Usage:
 *   Include AFTER your existing milestone-solo.js
 *     <script src="addons/milestone-solo.js"></script>
 *     <script src="addons/milestone-solo.patched.v1.js"></script>
 */
(function(){
  "use strict";
  const NS = window.KQ_MilestoneSolo = window.KQ_MilestoneSolo || {};

  // Shared pool for flags
  let _FLAG_POOL = NS.__FLAG_POOL || [];
  let _flagLoadInFlight = null;
  function _shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; [a[i],a[j]]=[a[j],a[i]]; } return a; }

  // Public test helper
  NS.testFlagQuestion = async function(){
    await _loadFlagsLT();
    const q = _pickFlagQuestion();
    console.log("[milestone-solo patch] sample:", q);
    return q;
  };

  // Fix 1: robust loader from Wikidata P41 with no UN and no ended statements
  async function _loadFlagsLT(){
    if(_FLAG_POOL.length) return;
    if(_flagLoadInFlight) return _flagLoadInFlight;
    _flagLoadInFlight = (async()=>{
      const q = `SELECT ?c ?cLabel ?flag WHERE {
        ?c wdt:P31 wd:Q6256 .
        ?c p:P41 ?st .
        ?st ps:P41 ?flag .
        FILTER NOT EXISTS { ?st pq:P582 ?ended }
        FILTER(NOT CONTAINS(LCASE(STR(?flag)),"united_nations"))
        SERVICE wikibase:label { bd:serviceParam wikibase:language "lt,en". }
      } LIMIT 1000`;
      const url = "https://query.wikidata.org/sparql?format=json&query="+encodeURIComponent(q);
      try{
        const ctrl = new AbortController(); const to = setTimeout(()=>ctrl.abort(), 7000);
        const r = await fetch(url,{headers:{Accept:"application/sparql-results+json"}, signal: ctrl.signal});
        clearTimeout(to);
        const rows = (await r.json())?.results?.bindings || [];
        const push = (qid,nameLT,flagURL)=>{
          if(!qid||!nameLT||!flagURL) return;
          _FLAG_POOL.push({qid,nameLT,flagURL});
        };
        for(const m of rows){
          const qid = (m.c?.value||"").split("/").pop();
          const nameLT = m.cLabel?.value || "";
          let flag = m.flag?.value || "";
          if(flag && !flag.includes("Special:FilePath")){
            const fname = decodeURIComponent(flag.split("/").pop());
            flag = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fname)}?width=640`;
          } else if(flag){
            flag += (flag.includes("?")?"&":"?")+"width=640";
          }
          push(qid, nameLT, flag);
        }
      }catch(e){
        console.warn("[milestone-solo patch] flag load failed, using minimal fallback", e);
        // Minimal fallback to keep game functional
        _FLAG_POOL.push(
          {qid:"Q37", nameLT:"Lietuva", flagURL:"https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Lithuania.svg?width=640"},
          {qid:"Q212", nameLT:"Ukraina", flagURL:"https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Ukraine.svg?width=640"},
          {qid:"Q183", nameLT:"Vokietija", flagURL:"https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Germany.svg?width=640"},
          {qid:"Q145", nameLT:"Jungtinė Karalystė", flagURL:"https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_the_United_Kingdom.svg?width=640"}
        );
      } finally { _flagLoadInFlight = null; }
    })();
    return _flagLoadInFlight;
  }

  // Fix 2: always include the correct option
  function _pickFlagQuestion(){
    if(!_FLAG_POOL.length) return null;
    const seed = _FLAG_POOL[(Math.random()*_FLAG_POOL.length)|0];
    const correct = seed.nameLT;

    const pool = _shuffle(_FLAG_POOL.filter(x=>x.nameLT!==correct)).slice(0,48);
    const distract=[], seen=new Set([correct]);
    for(const it of pool){
      const nm = (it.nameLT||"").trim();
      if(nm && !seen.has(nm)){ distract.push(nm); seen.add(nm); if(distract.length===3) break; }
    }
    while(distract.length<3) distract.push("Nežinoma šalis");

    let opts = _shuffle([correct, ...distract]).slice(0,4);
    if(!opts.includes(correct)){ opts[opts.length-1] = correct; opts = _shuffle(opts); }
    const keys = ["A","B","C","D"];
    const correctKey = keys[opts.indexOf(correct)] || "A";

    return {
      qid: seed.qid,
      q: "Kuri tai šalis?",
      html: `<div style="display:flex;flex-direction:column;align-items:center;gap:8px"><div style="font-weight:900">Kuri tai šalis?</div><img alt="vėliava" src="${seed.flagURL}" style="max-width:min(88vw,720px);width:100%;border-radius:12px;border:1px solid #1E2A3F"/></div>`,
      options: opts,
      keys,
      correctKey,
      correctText: correct,
      note: "Šaltinis: Wikidata P41 / Commons"
    };
  }

  // Expose or override on NS
  NS.loadFlagsLT = _loadFlagsLT;
  NS.pickFlagQuestion = _pickFlagQuestion;

  // Optional: auto hook if the core exposes a registry
  if(window.KQuiz?.registerQuestionSource){
    window.KQuiz.registerQuestionSource("flags-wikidata-fix", {
      preload: _loadFlagsLT,
      next: ()=>{ const q=_pickFlagQuestion(); return q; }
    });
  }
})();


/* === Hotfix v1.2: exclude Nepal flag and normalize sizing === */
(function(){
  "use strict";
  const NS = window.KQ_MilestoneSolo = window.KQ_MilestoneSolo || {};

  // Override loader to exclude Nepal (wd:Q837) and UN + ended flags
  NS.loadFlagsLT = async function _loadFlagsLT(){
    if(NS.__FLAG_POOL && NS.__FLAG_POOL.length) return;
    const q = `SELECT ?c ?cLabel ?flag WHERE {
      ?c wdt:P31 wd:Q6256 .
      FILTER(?c != wd:Q837)            # exclude Nepal (non-rectangular flag)
      ?c p:P41 ?st .
      ?st ps:P41 ?flag .
      FILTER NOT EXISTS { ?st pq:P582 ?ended }
      FILTER(NOT CONTAINS(LCASE(STR(?flag)),"united_nations"))
      SERVICE wikibase:label { bd:serviceParam wikibase:language "lt,en". }
    } LIMIT 1000`;
    const url = "https://query.wikidata.org/sparql?format=json&query="+encodeURIComponent(q);
    const pool = [];
    try{
      const r = await fetch(url,{headers:{Accept:"application/sparql-results+json"}});
      const rows = (await r.json())?.results?.bindings || [];
      for(const m of rows){
        const qid = (m.c?.value||"").split("/").pop();
        const nameLT = m.cLabel?.value || "";
        let flag = m.flag?.value || "";
        if(flag && !flag.includes("Special:FilePath")){
          const fname = decodeURIComponent(flag.split("/").pop());
          flag = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fname)}?width=640`;
        } else if(flag){
          flag += (flag.includes("?")?"&":"?")+"width=640";
        }
        if(qid && nameLT && flag) pool.push({qid,nameLT,flagURL:flag});
      }
    }catch(_){ /* keep existing fallback if any */ }
    NS.__FLAG_POOL = pool.length ? pool : (NS.__FLAG_POOL||[]);
  };

  // Wrap pick to enforce consistent flag box and keep correct option logic
  const _oldPick = NS.pickFlagQuestion;
  NS.pickFlagQuestion = function(){
    const q = _oldPick ? _oldPick() : null;
    if(!q) return q;
    // extract original src if present
    const m = /src=\"([^\"]+)/.exec(q.html) || /src="([^"]+)/.exec(q.html) || [];
    const src = m[1] || "";
    q.html = `<div style="display:flex;flex-direction:column;align-items:center;gap:8px">
      <div style="font-weight:900">Kuri tai šalis?</div>
      <div style="width:min(88vw,720px);max-width:100%;height:min(42vh,420px);display:flex;align-items:center;justify-content:center;border-radius:12px;border:1px solid #1E2A3F;background:#0b1124;overflow:hidden">
        <img alt="vėliava" src="${src}" style="max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;image-rendering:auto"/>
      </div>
    </div>`;
    return q;
  };
})();
