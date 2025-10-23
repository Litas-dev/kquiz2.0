/*!
 * KQuiz add-on: Dvikova â€¢ Herbai (v3.4.3)
 * Simple synchronous registration (like v3.3.2) so Settings sees it.
 * + Tick sound, winner +points, VS in rules, nicer buttons, robust close.
 */
(function(){
  "use strict";
  if(!window.KQuiz || !KQuiz.registerAddon || !KQuiz.util || !KQuiz.control){
    console.warn("[duel-vote-inline] KQuiz core not ready. Load this script AFTER core.");
    return;
  }

  const cfg = { secPerTry:25, poolLimit:450, imgWidth:640, stealPct:0.20 };

  let enabled=true, active=false, closing=false;
  let attacker=null, defender=null;
  let pool=[], used=new Set();
  let timer=null, endAt=0, startMs=0;
  let correctKey="A", options=[], current=null, winner=null;
  let stacks=null, counters=null;
  let uninstallSniffer=null;
  let lockedOnce=new Set();
  let _lastDelta = 0;

  const { $, shuffle, parseAnswer, banner } = KQuiz.util;
  const { pauseMain, resumeFlow, setChatGuard, clearChatGuard } = KQuiz.control;

  // ===== WS chat sniffer =====
  function installChatSniffer(handler){
    const OrigWS = window.WebSocket;
    if(!OrigWS || OrigWS.__kqWrappedDuel) return ()=>{};
    function wrapWS(url, protocols){
      const ws = protocols? new OrigWS(url, protocols) : new OrigWS(url);
      const origOnMsg = ws.onmessage;
      ws.addEventListener("message", ev=>{
        try{
          const data = typeof ev.data==="string" ? ev.data : "";
          if(!data) return;
          const m = JSON.parse(data);
          if(m && m.type==="chat") handler(m);
        }catch{}
      });
      if(origOnMsg) ws.onmessage = origOnMsg;
      return ws;
    }
    wrapWS.prototype = OrigWS.prototype;
    wrapWS.__kqWrappedDuel = true;
    window.WebSocket = wrapWS;
    return ()=>{ window.WebSocket = OrigWS; };
  }

  // ===== Data: Wikidata herbai (LT) =====
  const H = { headers:{Accept:"application/sparql-results+json"} };
  const WQ = (q)=>"https://query.wikidata.org/sparql?format=json&query="+encodeURIComponent(q);
  const commons=(u,w)=> u&&u.includes("Special:FilePath")?u+(u.includes("?")?"&":"?")+"width="+w:
    "https://commons.wikimedia.org/wiki/Special:FilePath/"+encodeURIComponent(decodeURIComponent((u||'').split('/').pop()))+"?width="+w;

  async function ensurePool(){
    if(pool.length) return;
    const q = `SELECT ?item ?itemLabel ?img WHERE {
      ?item wdt:P17 wd:Q37 ; wdt:P94 ?img .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "lt,en". }
    } LIMIT ${cfg.poolLimit}`;
    const r = await fetch(WQ(q),H).then(x=>x.json()).catch(()=>({}));
    const rows = (r.results&&r.results.bindings)||[];
    pool = rows.map(b=>({ id: b.item.value.split("/").pop(), name: b.itemLabel?.value||"", img: commons(b.img?.value||"", cfg.imgWidth) }))
               .filter(x=>x.id && x.name && x.img);
  }

  // ===== UI =====
  function nuke(){ try{ document.getElementById("kq-duel")?.remove(); }catch{} }
  function ui(){
    nuke();
    const wrap=document.createElement("div");
    wrap.id="kq-duel";
    wrap.style.cssText="position:fixed;inset:0;z-index:9998;display:flex;align-items:center;justify-content:center;background:radial-gradient(1200px 500px at 50% -200px,#251421 0%,#0b0f1d 55%),linear-gradient(180deg,#0b0f1d,#070a12);padding:12px";
    wrap.innerHTML=`
      <div style="width:min(1100px,100%);max-height:100vh;display:grid;gap:12px;grid-template-rows:auto auto 1fr auto auto">
        <div style="display:flex;align-items:center;justify-content:center;gap:12px">
          <div class="pill" style="cursor:default;border-radius:999px;padding:8px 14px;border:1px solid #2a365f;background:#0f162d;color:#cfe0ff;">Dvikova</div>
          <div style="flex:1;height:12px;border-radius:999px;background:#121a35;overflow:hidden"><i id="dvFill" style="display:block;height:100%;width:0;background:linear-gradient(90deg,#ff5964,#3bd671)"></i></div>
          <div class="pill" id="dvLeft" style="cursor:default;min-width:54px;text-align:center;border-radius:999px;padding:8px 14px;border:1px solid #2a365f;background:#0f162d;color:#cfe0ff;">${cfg.secPerTry}</div>
        </div>

        <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;background:linear-gradient(90deg,rgba(220,38,38,.18),rgba(59,130,246,.18));border:1px solid #313657;border-radius:16px;padding:10px">
          <div style="display:flex;align-items:center;gap:10px;justify-content:flex-start">
            ${attacker?.avatar?`<img src="${attacker.avatar}" referrerpolicy="no-referrer" style="width:96px;height:96px;border-radius:50%;border:2px solid rgba(220,38,38,.65);object-fit:cover">`:"<div style='width:96px;height:96px;border-radius:50%;border:2px solid rgba(220,38,38,.65);background:#20161b'></div>"}
            <div><div class="pill" style="cursor:default;border-radius:999px;padding:6px 10px;border:1px solid #4a1b2f;background:#2a1320;color:#cfe0ff;">UÅ¾puolÄ—jas</div><div class="big" style="font-size:22px;font-weight:900">${attacker?.name||"Å½aidÄ—jas A"}</div></div>
          </div>
          <div style="font-size:28px;font-weight:900;letter-spacing:1px;padding:4px 10px;border:1px dashed #3a4667;border-radius:999px;background:#0e1427">VS</div>
          <div style="display:flex;align-items:center;gap:10px;justify-content:flex-end">
            <div style="text-align:right"><div class="pill" style="cursor:default;border-radius:999px;padding:6px 10px;border:1px solid #1e3553;background:#111f2c;color:#cfe0ff;">GynÄ—jas</div><div class="big" style="font-size:22px;font-weight:900">${defender?.name||"Å½aidÄ—jas B"}</div></div>
            ${defender?.avatar?`<img src="${defender.avatar}" referrerpolicy="no-referrer" style="width:96px;height:96px;border-radius:50%;border:2px solid rgba(59,130,246,.65);object-fit:cover">`:"<div style='width:96px;height:96px;border-radius:50%;border:2px solid rgba(59,130,246,.65);background:#121a26'></div>"}
          </div>
        </div>

        <div id="dvMedia" style="width:100%;border:1px solid #233154;border-radius:16px;overflow:auto;background:#0b1124;display:flex;align-items:center;justify-content:center;min-height:35vh;max-height:48vh"></div>
        <div id="dvAns" style="display:grid;gap:10px"></div>

        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
          <button id="dvNextQ" class="pill" style="cursor:pointer;user-select:none;border-radius:999px;padding:8px 14px;border:1px solid #2a365f;background:#0f162d;color:#cfe0ff;">Keisti klausimÄ…</button>
          <button id="dvContinue" class="pill" style="cursor:pointer;user-select:none;border-radius:999px;padding:8px 14px;border:1px solid #2a365f;background:#0f162d;color:#cfe0ff;display:none">TÄ™sti</button>
        </div>
      </div>

      <div id="dvRules" style="position:fixed;inset:0;background:rgba(7,10,18,.92);display:flex;align-items:center;justify-content:center;z-index:10000">
        <div style="width:min(720px,92%);border:1px solid #2a365f;border-radius:16px;background:#0b1124;padding:16px;display:grid;gap:12px">
          <div class="big" style="font-size:22px;font-weight:900">Dvikovos taisyklÄ—s</div>

          <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;background:linear-gradient(90deg,rgba(220,38,38,.18),rgba(59,130,246,.18));border:1px solid #313657;border-radius:16px;padding:10px">
            <div style="display:flex;align-items:center;gap:10px;justify-content:flex-start">
              ${attacker?.avatar?`<img src="${attacker.avatar}" referrerpolicy="no-referrer" style="width:64px;height:64px;border-radius:50%;border:2px solid rgba(220,38,38,.65);object-fit:cover">`:"<div style='width:64px;height:64px;border-radius:50%;border:2px solid rgba(220,38,38,.65);background:#20161b'></div>"}
              <div><div class="pill" style="cursor:default;border-radius:999px;padding:6px 10px;border:1px solid #4a1b2f;background:#2a1320;color:#cfe0ff;">UÅ¾puolÄ—jas</div><div class="big" style="font-size:18px;font-weight:900">${attacker?.name||"Å½aidÄ—jas A"}</div></div>
            </div>
            <div style="font-size:22px;font-weight:900;letter-spacing:1px;padding:4px 10px;border:1px dashed #3a4667;border-radius:999px;background:#0e1427">VS</div>
            <div style="display:flex;align-items:center;gap:10px;justify-content:flex-end">
              <div style="text-align:right"><div class="pill" style="cursor:default;border-radius:999px;padding:6px 10px;border:1px solid #1e3553;background:#111f2c;color:#cfe0ff;">GynÄ—jas</div><div class="big" style="font-size:18px;font-weight:900">${defender?.name||"Å½aidÄ—jas B"}</div></div>
              ${defender?.avatar?`<img src="${defender.avatar}" referrerpolicy="no-referrer" style="width:64px;height:64px;border-radius:50%;border:2px solid rgba(59,130,246,.65);object-fit:cover">`:"<div style='width:64px;height:64px;border-radius:50%;border:2px solid rgba(59,130,246,.65);background:#121a26'></div>"}
            </div>
          </div>

          <ul class="sub" style="line-height:1.5">
            <li>Rodomas Lietuvos <strong>herbas</strong>.</li>
            <li>Du dalyviai atsakinÄ—ja tik <strong>A/B/C/D</strong>. Po <strong>vienÄ… bandymÄ…</strong>.</li>
            <li>Pirmas teisingai â€“ laimi. LaimÄ—tojas perima <strong>20%</strong> prieÅ¡ininko taÅ¡kÅ³.</li>
            <li>Laikas: <strong>${cfg.secPerTry}s</strong>. Jei niekas teisingai â€“ naujas klausimas.</li>
          </ul>
          <div style="display:flex;justify-content:flex-end;gap:8px">
            <button id="dvStart" class="pill" style="cursor:pointer;user-select:none;border-radius:999px;padding:8px 14px;border:1px solid #2a365f;background:#0f162d;color:#cfe0ff;">PradÄ—ti dvikovÄ…</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    // ESC -> close
    wrap.addEventListener("keydown",(e)=>{ if(e.key==="Escape"){ close(); } });
    wrap.tabIndex=0; wrap.focus();
  }

  // HUD + tick
  let dvFill=null, dvLeft=null;
  let _lastTickSec=null; let _ac=null;
  function beep(){ try{ _ac = _ac || new (window.AudioContext||window.webkitAudioContext)(); const o=_ac.createOscillator(); const g=_ac.createGain(); o.type='square'; o.frequency.value=1200; g.gain.value=0.02; o.connect(g); g.connect(_ac.destination); o.start(); setTimeout(()=>{o.stop();},60);}catch{} }

  function setHud(sec){
    if(dvLeft) dvLeft.textContent=String(Math.max(0,sec));
    const t=cfg.secPerTry; const pct=t? (100*(t-sec)/t) : 0;
    if(dvFill) dvFill.style.width = pct+"%";
  }
  function startHud(){
    startMs=performance.now(); endAt=startMs+cfg.secPerTry*1000;
    dvLeft=$("#dvLeft"); dvFill=$("#dvFill"); setHud(cfg.secPerTry);
    if(timer) clearInterval(timer);
    timer=setInterval(()=>{
      const left=Math.max(0,Math.ceil((endAt-performance.now())/1000));
      setHud(left);
      if(_lastTickSec!==left){ _lastTickSec=left; beep(); }
      if(left<=0){ clearInterval(timer); timer=null; ask(true); }
    }, 200);
  }
  function stopHud(){ if(timer){ clearInterval(timer); timer=null; } }

  // Options
  function renderOptions(opts){
    const keys=["A","B","C","D"];
    const list=$("#dvAns"); list.innerHTML="";
    stacks=[[],[],[],[]]; counters=[0,0,0,0];
    opts.forEach((txt,i)=>{
      const row=document.createElement("div"); row.className="choice"; row.dataset.idx=String(i);
      row.style.cssText="display:flex;align-items:center;gap:10px;border:1px solid #263154;background:#0d1327;border-radius:14px;padding:14px";
      row.innerHTML = `<div class="key" style="font-weight:900">${keys[i]}</div><div class="txt" style="flex:1;min-width:0;font-size:18px">${txt||"â€”"}</div>
        <div style="display:flex;align-items:center;gap:8px">
          <div id="dvStack-${i}" style="display:flex;align-items:center;gap:6px"></div>
          <div id="dvMore-${i}" style="display:none;min-width:32px;height:28px;border-radius:999px;border:1px solid #1e2435;align-items:center;justify-content:center;font-size:13px;color:#cfe0ff;background:#101830;padding:0 10px">+0</div>
        </div>`;
      list.appendChild(row);
    });
  }
  function pushAvatar(i,name,avatar){
    const stack=$("#dvStack-"+i), more=$("#dvMore-"+i);
    if(!stack||!more) return;
    counters[i]=(counters[i]||0)+1;
    if((stacks[i]||[]).length<5 && avatar){
      const img=document.createElement("img"); img.alt=name; img.referrerPolicy="no-referrer";
      img.src=avatar; img.style.cssText="width:64px;height:64px;border-radius:50%;border:1px solid #1e2435;object-fit:cover;background:#1a2242";
      stack.appendChild(img); stacks[i].push(img);
    } else {
      more.style.display="flex"; const shown=Math.min(5,(stacks[i]||[]).length);
      more.textContent="+"+(counters[i]-shown);
    }
  }

  // Build question
  async function buildQ(){
    const avail = pool.filter(x=>!used.has(x.id));
    current = avail[(Math.random()*avail.length)|0] || pool[(Math.random()*pool.length)|0];
    used.add(current.id);
    const distract = shuffle(pool.filter(x=>x.id!==current.id)).slice(0,12).map(x=>x.name);
    let opts = shuffle([current.name, ...distract]).slice(0,4);
    if(!opts.includes(current.name)){ opts[0]=current.name; opts=shuffle(opts); }
    const keys=["A","B","C","D"]; const idx = opts.indexOf(current.name);
    return { media: current.img, opts, correctKey: keys[idx] };
  }

  async function ask(fromTimeout=false){
    winner=null; lockedOnce.clear(); clearChatGuard(); stopHud();
    const q = await buildQ().catch(()=>null);
    if(!q){ $("#dvMedia").innerHTML="<div class='sub'>Klaida kraunant duomenis.</div>"; return; }
    options=q.opts; correctKey=q.correctKey;
    $("#dvMedia").innerHTML = `<img src="${q.media}" alt="herbas" style="max-height:50vh;width:auto;object-fit:contain;display:block;margin:auto">`;
    renderOptions(options);
    $("#dvContinue").style.display="none"; $("#dvNextQ").disabled=false;
    bindGuard();
    startHud();
    if(fromTimeout){ banner?.("Naujas klausimas"); }
  }

  function isParticipant(m){
    const name = (m.displayName || m.user?.nickname || "").trim().toLowerCase();
    const aid = (attacker?.name||"").trim().toLowerCase();
    const did = (defender?.name||"").trim().toLowerCase();
    return name===aid || name===did;
  }

  function lockNameOnce(n){ const k=String(n||"").trim().toLowerCase(); if(lockedOnce.has(k)) return false; lockedOnce.add(k); return true; }

  function bindGuard(){
    setChatGuard((msg)=>{
      if(!active || winner) return true;
      if(!isParticipant(msg)) return true;
      const name=msg.displayName||msg.user?.nickname||"Å½aidÄ—jas";
      if(!lockNameOnce(name)) return true;
      const key = (msg.parsedAnswer || parseAnswer(String(msg.text||"")));
      if(!key) return true;
      const idx=["A","B","C","D"].indexOf(key);
      if(idx<0) return true;
      const avatar=msg.profilePicture||msg.profilePictureUrl||msg.user?.profilePicture||msg.user?.profilePictureUrl||"";
      pushAvatar(idx,name,avatar);
      if(key===correctKey){
        winner={ name, avatar, ms: performance.now()-startMs };
        reveal();
      }
      return true;
    });
  }

  function adjustScoresOnWin(winnerName, loserName){
    try{
      const players = KQuiz.state.players || {};
      const findIdByName = (nm)=> Object.keys(players).find(id => (players[id]?.name||"").trim().toLowerCase()===String(nm).trim().toLowerCase());
      const wid = findIdByName(winnerName);
      const lid = findIdByName(loserName);
      if(!wid || !lid) return;
      const wBefore = Number(players[wid].score||0);
      const lBefore = Number(players[lid].score||0);
      const delta = Math.max(0, Math.floor(lBefore * cfg.stealPct));
      players[lid].score = Math.max(0, lBefore - delta);
      players[wid].score = wBefore + delta;
      _lastDelta = delta;
      try{ KQuiz.emit && KQuiz.emit("scoresChanged",{ id:wid, before:wBefore, after:players[wid].score, player:players[wid], correct:true }); }catch{}
      try{ KQuiz.emit && KQuiz.emit("scoresChanged",{ id:lid, before:lBefore, after:players[lid].score, player:players[lid], correct:false }); }catch{}
    }catch{}
  }

  function showWinnerCard(){
    const card = document.createElement("div");
    card.id="dvWinner";
    card.style.cssText="position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;background:rgba(5,8,14,.78)";
    const name = winner?.name||"â€”";
    card.innerHTML = `
      <div style="width:min(740px,92%);border:1px solid #3a4a7a;border-radius:18px;background:linear-gradient(180deg,#0e1530,#0a1126);padding:18px;display:grid;gap:12px;box-shadow:0 24px 60px rgba(0,0,0,.45)">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="pill" style="cursor:default;border-radius:999px;padding:6px 10px;border:1px solid #2a365f;background:#0f162d;color:#cfe0ff;">Dvikova baigta</div>
          <div style="margin-left:auto" class="pill" id="dvTime">${winner? (winner.ms/1000).toFixed(2)+'s' : ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:14px">
          ${winner?.avatar?`<img src="${winner.avatar}" referrerpolicy="no-referrer" style="width:84px;height:84px;border-radius:50%;border:2px solid #2b6b43;object-fit:cover">`:""}
          <div>
            <div style="font-size:24px;font-weight:900">NugalÄ—tojas: ${name}</div>
            <div class="sub">UÅ¾dirbo: <span style="color:#9ef7bc;font-weight:800">+${_lastDelta||0}</span> taÅ¡kÅ³</div>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px">
          <button id="dvBack" class="pill" style="cursor:pointer;user-select:none;border-radius:999px;padding:8px 14px;border:1px solid #2a365f;background:#0f162d;color:#cfe0ff;">GrÄ¯Å¾ti Ä¯ Å¾aidimÄ…</button>
        </div>
      </div>`;
    document.body.appendChild(card);
    card.addEventListener("click",(e)=>{ if(e.target===card){ try{ document.getElementById("dvWinner")?.remove(); }catch{}; close(); }});
    document.addEventListener("keydown",function _esc(e){ if(e.key==="Escape"){ try{ document.getElementById("dvWinner")?.remove(); }catch{}; close(); document.removeEventListener("keydown",_esc); }});
    $("#dvBack").onclick = ()=> { try{ document.getElementById("dvWinner")?.remove(); }catch{}; close(); };
  }

  function reveal(){
    stopHud(); clearChatGuard();
    const keys=["A","B","C","D"]; const idx=keys.indexOf(correctKey);
    const row=document.querySelector(`#dvAns .choice[data-idx="${idx}"]`);
    if(row){ row.style.outline="2px solid #2b6b43"; row.classList.add("correct"); }
    $("#dvNextQ").disabled=true;
    $("#dvContinue").style.display="inline-block";
    if(winner){
      const a=(attacker?.name||"").trim(); const d=(defender?.name||"").trim();
      const loser = (winner.name.trim().toLowerCase() === a.trim().toLowerCase()) ? d : a;
      adjustScoresOnWin(winner.name, loser);
      setTimeout(showWinnerCard, 300);
    }
  }

  function findPlayer(n){
    if(!n) return null;
    const pid = Object.keys(KQuiz.state.players||{}).find(id=> (KQuiz.state.players[id]?.name||"").trim().toLowerCase()===String(n).trim().toLowerCase());
    if(pid) return { name: KQuiz.state.players[pid].name, avatar: KQuiz.state.players[pid].avatar||"" };
    return { name: n };
  }

  const _kovaCD = new Map();
  function canChallenge(name){
    const key = String(name||"").trim().toLowerCase();
    const now = Date.now();
    const last = _kovaCD.get(key)||0;
    if(now - last < 45000) return false;
    _kovaCD.set(key, now);
    return true;
  }
  function resolveTopOpponent(challengerName){
    try{
      const cname = String(challengerName||"").trim().toLowerCase();
      const players = Object.entries(KQuiz.state.players||{}).map(([id,p])=>({
        id, name: p?.name||id, score: Number(p?.score)||0, avatar: p?.avatar||""
      }));
      const top = players.sort((a,b)=>b.score-a.score).slice(0,10).filter(p=>p.name.trim().toLowerCase()!==cname);
      const pool2 = top.length ? top : players.filter(p=>p.name.trim().toLowerCase()!==cname);
      if(!pool2.length) return null;
      const pick = pool2[(Math.random()*pool2.length)|0];
      return pick ? { name: pick.name, avatar: pick.avatar||"" } : null;
    }catch{ return null; }
  }

  function start(aName, dName){
    if(active) return;
    active=true; used.clear(); winner=null; lockedOnce.clear();
    attacker = findPlayer(aName) || { name: aName||"Å½aidÄ—jas A" };
    defender = findPlayer(dName) || { name: dName||"Å½aidÄ—jas B" };
    pauseMain(); ui();
    ensurePool().then(()=>{
      const btn=$("#dvStart"); if(btn){ btn.onclick = ()=>{ $("#dvRules")?.remove(); ask(false); }; }
    });
    $("#dvNextQ").onclick = ()=> ask(true);
    $("#dvContinue").onclick = ()=> close();
    if(!$("#dvRules")) ask(false);
  }

  function close(){
    if(closing) return; closing=true;
    stopHud(); clearChatGuard();
    try{ document.getElementById("dvWinner")?.remove(); }catch{}
    try{ document.getElementById("kq-duel")?.remove(); }catch{}
    try{ resumeFlow(); }catch{}
    active=false; setTimeout(()=>{ closing=false; }, 60);
  }

  // Process chat commands via WS sniffer
  function onChat(m){
    try{
      const txt = String(m.text||"").trim().toLowerCase();
      if(!txt.startsWith("!kova") && !txt.startsWith("/kova")) return;
      const rest = txt.replace(/^[!/].*?kova/,"").trim();
      const challenger = (m.displayName || m.user?.nickname || "").trim();
      if(rest==="stop"){
        const uname = challenger.toLowerCase();
        const a=(attacker?.name||"").trim().toLowerCase();
        const d=(defender?.name||"").trim().toLowerCase();
        const isHost = !!m.isHost || !!m.host || (m.user && (m.user.role==="host" || m.user.isHost));
        if(isHost || uname===a || uname===d){ close(); }
        return;
      }
      if(rest.includes("|")){
        const [a,b]=rest.split("|").map(s=>s.trim());
        start(a||challenger,b);
        return;
      }
      if(!canChallenge(challenger)) return;
      const opp=resolveTopOpponent(challenger);
      if(opp) start(challenger, opp.name); else start(challenger);
    }catch{}
  }

  KQuiz.registerAddon({
    id: "duel-vote",
    name: "Dvikova: Herbai (LT)",
    description: "TaisyklÄ—s su VS, laikmatis su garsu, nugalÄ—tojo kortelÄ— su +taÅ¡kais. Vienas bandymas. 20% perÄ—mimas.",
    defaultEnabled: true,
    enable(){ enabled=true; uninstallSniffer = installChatSniffer(onChat); },
    disable(){ enabled=false; try{ uninstallSniffer && uninstallSniffer(); }catch{} if(active) close(); }
  });

  // Public API
  window.KQ_Duel = { start, close };
})();


