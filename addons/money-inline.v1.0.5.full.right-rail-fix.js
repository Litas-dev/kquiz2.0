/*!
 * KQuiz add-on: Pinigai (banknotai/monetos) — atspėk šalį • v1.0.4.full
 * - Keeps Wikidata/Commons live pool (banknote Q8142, coin Q41207) like v1.0.2
 * - Fix: robust awarding (name→ID normalization, never drops payout)
 * - Fix: one answer per user; avatar rail on the RIGHT, fixed card height
 * - Fix: deterministic trigger ONLY on #5,15,25,35… with global mini lock
 * - Keeps intro with fun.png; hides image if missing
 */
(function(){
  "use strict";
  if(!window.KQuiz || !KQuiz.registerAddon || !KQuiz.util || !KQuiz.control){
    console.warn("[money-inline] KQuiz core not ready."); return;
  }

  // ---------- Global lock ----------
  const ADDON_ID = "money-inline";
  function acquireLock(){
    if(!window.KQ_MINI_LOCK){ window.KQ_MINI_LOCK = { held:false, by:null }; }
    if(window.KQ_MINI_LOCK.held && window.KQ_MINI_LOCK.by!==ADDON_ID) return false;
    window.KQ_MINI_LOCK.held = true; window.KQ_MINI_LOCK.by = ADDON_ID; return true;
  }
  function releaseLock(){
    if(window.KQ_MINI_LOCK && window.KQ_MINI_LOCK.by===ADDON_ID){ window.KQ_MINI_LOCK.held=false; window.KQ_MINI_LOCK.by=null; }
  }

  // ---------- Config ----------
const cfg = {
  revealHoldMs: 1200,
  questions: 5,
  secPerQ: 25,
  bonus: 50,
  breakMs: 1200,
  poolLimit: 1200,
  minCountries: 80,
  preferBanknotes: true
};
const BLACKLIST_KEY = "kquiz-money-blacklist";

  // ---------- State ----------
  let enabled = true, active = false, qIdx = 0;
  let pool=[], used=new Set();
  let startMs=0, hudTick=null, hudLeft=null, hudFill=null;
  let correctKey="A", options=[], current=null, phase="idle";
  let ansCounts = [0,0,0,0];
const perQ = [];
const totals = new Map();
let currentQuestion = null;
const blacklist = new Set(loadBlacklist());

  const { $, shuffle, parseAnswer, banner } = KQuiz.util;
  const { pauseMain, resumeFlow, setChatGuard, clearChatGuard } = KQuiz.control;
  const norm = s => (s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();

  // ---------- WD helpers ----------
const H = { headers:{Accept:"application/sparql-results+json"} };
const WQ = (q)=>"https://query.wikidata.org/sparql?format=json&query="+encodeURIComponent(q);
const commons=(u,w=900)=> u ? "https://commons.wikimedia.org/wiki/Special:FilePath/"+encodeURIComponent(decodeURIComponent((u||"").split("/").pop()))+`?width=${w}` : "";

function loadBlacklist(){
  try{
    const raw = JSON.parse(localStorage.getItem(BLACKLIST_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  }catch{
    return [];
  }
}
function saveBlacklist(){
  try{ localStorage.setItem(BLACKLIST_KEY, JSON.stringify(Array.from(blacklist))); }catch{}
}
function notify(text){
  const toast = document.createElement("div");
  toast.textContent = text;
  toast.style.cssText = "position:fixed;left:50%;top:42px;transform:translateX(-50%);background:#101a31;color:#cfe0ff;border:1px solid #2a365f;padding:6px 12px;border-radius:10px;font-weight:700;z-index:10100;opacity:0;transition:opacity .2s ease";
  document.body.appendChild(toast);
  requestAnimationFrame(()=>toast.style.opacity="1");
  setTimeout(()=>{ toast.style.opacity="0"; setTimeout(()=>toast.remove(),200); },1800);
}

async function fetchMoneyRaw(kind){
    const inst = kind==="banknote" ? "wd:Q8142" : "wd:Q41207";
    const q=`SELECT ?item ?img ?c ?cLabel WHERE {
      ?item wdt:P31/wdt:P279* ${inst} .
      ?item wdt:P18 ?img .
      ?item wdt:P17 ?c .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "lt,ltl,en". }
    } LIMIT ${Math.floor(cfg.poolLimit/2)}`;
    const r = await fetch(WQ(q), H);
    const d = await r.json();
    const rows = (d.results && d.results.bindings)||[];
    return rows.map(b=> ({
      item: (b.item?.value||"").split("/").pop(),
      img:  commons(b.img?.value||""),
      countryId: (b.c?.value||"").split("/").pop(),
      countryName: (b.cLabel?.value||"").trim()
    })).filter(x=>x.img && x.countryId && x.countryName);
  }

  async function ensurePool(){
    if(pool.length) return;
    let bank=[], coin=[];
    try{ bank = cfg.preferBanknotes ? await fetchMoneyRaw("banknote") : []; }catch(e){ console.warn("[money-inline] banknote WD fail", e); }
    try{ coin  = await fetchMoneyRaw("coin"); }catch(e){ console.warn("[money-inline] coin WD fail", e); }
    let all = cfg.preferBanknotes ? bank.concat(coin) : coin.concat(bank);

    // Pick one representative per country
    const byC = new Map();
    for(const x of all){
      const arr = byC.get(x.countryId) || [];
      if(arr.length < 3) arr.push(x);
      byC.set(x.countryId, arr);
    }
    const countries = [...byC.entries()].map(([countryId, arr])=>{
      const pick = arr.find(a=>a.item && a.img && a.countryId===countryId) || arr[0];
      return pick;
    }).filter(Boolean);

    const seen = new Set();
    pool = countries.filter(x=>{ if(seen.has(x.countryId)) return false; seen.add(x.countryId); return true; })
      .map(x=>({...x, countryName: x.countryName.replace(/\s*\([^)]*\)\s*/g,"").trim()}))
      .filter(x => !blacklist.has(String(x.item||"")));

    shuffle(pool);
    if(pool.length < cfg.minCountries){
      console.warn("[money-inline] mažai šalių iš WD:", pool.length);
    }
  }

  function pickQuestion(){
    const filtered = pool.filter(x => !blacklist.has(String(x.item||"")));
    if(!filtered.length) return null;
    const avail = filtered.filter(x=>!used.has(x.countryId));
    const pick = avail.length ? avail[(Math.random()*avail.length)|0] : filtered[(Math.random()*filtered.length)|0];
    used.add(pick.countryId);
    current = pick;
    const set = new Set([pick.countryName]);
    const distract=[];
    shuffle(filtered).forEach(x=>{ if(distract.length<16 && !set.has(x.countryName)){ set.add(x.countryName); distract.push(x.countryName); } });
    let opts=[pick.countryName, ...distract.slice(0,3)];
    const uniq=new Set(); opts=opts.filter(n=>{ const k=(n||"").trim(); if(!k||uniq.has(k)) return false; uniq.add(k); return true; }).slice(0,4);
    if(!opts.includes(pick.countryName)) opts[opts.length-1]=pick.countryName;
    opts=shuffle(opts);
    const keys=["A","B","C","D"]; const correctIdx=opts.indexOf(pick.countryName);
    return { media: pick.img, opts, correctKey: keys[correctIdx], correctCountry: pick.countryName, itemId: pick.item, countryId: pick.countryId };
  }

  // ---------- UI ----------
  function mountOverlay(){
    const el=document.createElement("div");
    el.id="kq-money-overlay";
    el.style.cssText="position:fixed;inset:0;background:rgba(7,10,18,.96);z-index:10040;display:flex;align-items:center;justify-content:center;padding:12px";
    const coverImg=(()=>{ try{ if(window.KQ_ASSETS?.image) return window.KQ_ASSETS.image("pinigas.png"); }catch{} return "assets/images/pinigas.png"; })();
    const tickSrc=(()=>{ try{ if(window.KQ_ASSETS?.audio) return window.KQ_ASSETS.audio("clock-67787.mp3"); }catch{} return "assets/audio/clock-67787.mp3"; })();
    el.innerHTML=`
      <div style="width:min(1060px,100%);display:grid;gap:12px">
        <div style="font-weight:900;letter-spacing:.6px;text-align:center">Pinigų iššūkis</div>

        <div id="km-intro" style="display:grid;gap:12px;border:1px solid #273149;border-radius:14px;background:#0b1124;padding:12px">
          <div class="cover" style="display:flex;align-items:center;justify-content:center;border:1px solid #233154;border-radius:12px;overflow:hidden;background:#091124;min-height:200px">
            <img src="" alt="fun" onerror="this.style.display='none'" style="max-width:100%;max-height:46vh;object-fit:contain;opacity:.95">
          </div>
          <div class="sub" style="color:#cfe0ff">
            <strong>Taisyklės:</strong> 5 klausimai. Rodo banknotą ar monetą. Pasirink šalį (A/B/C/D). Vienas atsakymas žaidėjui.
          </div>
          <div style="display:flex;justify-content:flex-end">
            <button id="km-start" style="cursor:pointer;border:1px solid #2a365f;background:linear-gradient(180deg,#0f162d,#0b1022);color:#cfe0ff;border-radius:999px;padding:10px 18px;font-weight:800;letter-spacing:.3px">Tęsti</button>
          </div>
        </div>
        <audio id="km-tick" src="" preload="auto"></audio>
        <div id="km-live" style="display:none;gap:12px">
          <div id="km-media" style="width:100%;border:1px solid #233154;border-radius:12px;overflow:hidden;background:#0b1124;display:flex;align-items:center;justify-content:center;min-height:220px;position:relative;padding:12px">
            <button id="km-hide" title="Paslėpti klausimą" style="position:absolute;top:10px;right:10px;border:1px solid rgba(255,255,255,.25);background:rgba(15,22,45,.75);color:#cfe0ff;border-radius:999px;padding:4px 8px;font-size:12px;opacity:.55;cursor:pointer;z-index:2">×</button>
            <img id="km-media-img" src="" alt="pinigai" style="width:100%;max-height:56vh;object-fit:contain;opacity:.97">
          </div>
          <div id="km-timer" style="display:flex;justify-content:flex-end;align-items:center;gap:8px">
            <div class="progress" style="flex:1;height:12px;border-radius:999px;background:#121a35;overflow:hidden">
              <i id="km-fill" style="display:block;height:100%;width:0;background:linear-gradient(90deg,#ff5964,#3bd671)"></i>
            </div>
            <div id="km-left" class="pill" style="min-width:48px;text-align:center">${cfg.secPerQ}</div>
          </div>
          <div id="km-ans" style="display:grid;gap:10px"></div>
          <div id="km-break" style="display:none;align-items:center;justify-content:space-between;gap:10px;border:1px dashed #2a365f;border-radius:12px;padding:10px;background:#0c1224">
            <div id="km-break-msg" class="sub">—</div>
            <button id="km-next" style="cursor:pointer;border:1px solid #2a365f;background:linear-gradient(180deg,#0f162d,#0b1022);color:#cfe0ff;border-radius:999px;padding:10px 16px;font-weight:700;letter-spacing:.3px;box-shadow:0 10px 24px rgba(0,0,0,.35);">Kitas klausimas</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);
    const hideBtn = el.querySelector("#km-hide");
    if(hideBtn){
      hideBtn.addEventListener("click",(ev)=>{
        ev.preventDefault();
        ev.stopPropagation();
        blacklistCurrent();
      });
      hideBtn.addEventListener("mouseenter",()=>hideBtn.style.opacity="1");
      hideBtn.addEventListener("mouseleave",()=>hideBtn.style.opacity="0.55");
    }
    try{ el.querySelector(".cover img").src = coverImg; }catch{}
    try{ el.querySelector("#km-tick").src = tickSrc; }catch{}
    el.querySelector("#km-start").onclick=()=>{ $("#km-intro").style.display="none"; $("#km-live").style.display="grid"; phase="play"; showQ(); };
  }
  function unmount(){ document.getElementById("kq-money-overlay")?.remove(); }

  function setHud(sec){ if(hudLeft) hudLeft.textContent=String(Math.max(0,sec)); const t=cfg.secPerQ; const pct=t?(100*(t-sec)/t):0; if(hudFill) hudFill.style.width=pct+"%"; }
  function startHud(){
    hudLeft=$("#km-left"); hudFill=$("#km-fill");
    const tick = document.getElementById("km-tick");
    try { if(tick){ tick.currentTime = 0; tick.loop = true; tick.play(); } } catch {}
    const endAt=performance.now()+cfg.secPerQ*1000; setHud(cfg.secPerQ);
    if(hudTick) clearInterval(hudTick);
    hudTick=setInterval(()=>{ const left=Math.max(0,Math.ceil((endAt-performance.now())/1000)); setHud(left); if(left<=0){ clearInterval(hudTick); hudTick=null; reveal(); } },200);
  }
  function stopHud(){
    if(hudTick){ clearInterval(hudTick); hudTick=null; }
    try{ document.getElementById('km-tick')?.pause(); }catch{}
  }
  // Avatars rail
  function makeAvatar(url,name){
    if(url){ const img=document.createElement("img"); img.src=url; img.referrerPolicy="no-referrer"; img.style.cssText="width:28px;height:28px;border-radius:50%;object-fit:cover;border:1px solid #2a365f;box-shadow:0 2px 6px rgba(0,0,0,.3);flex:0 0 28px" ; img.alt=name||""; return img; }
    const d=document.createElement("div"); d.textContent=(name||"?").trim().charAt(0).toUpperCase()||"•"; d.style.cssText="width:28px;height:28px;border-radius:50%;background:#1b2544;color:#cfe0ff;display:flex;align-items:center;justify-content:center;font-weight:900;border:1px solid #2a365f;flex:0 0 28px"; return d;
  }
  function addToRail(idx, avatarUrl, name, uid){
    const rail=document.querySelector(`#km-ans .choice[data-idx="${idx}"] .rail`);
    if(!rail) return;
    // dedup by uid if provided
    if(uid){
      const exists = rail.querySelector(`[data-uid="${uid}"]`);
      if(exists) return;
    }
    if(!rail) return;
    ansCounts[idx]=(ansCounts[idx]||0)+1; const count=ansCounts[idx];
    let more=rail.querySelector(".more-bubble");
    if(!more){ more=document.createElement("div"); more.className="more-bubble"; more.style.cssText="display:none;width:28px;height:28px;border-radius:50%;background:#1b2a4a;color:#cfe0ff;display:flex;align-items:center;justify-content:center;font-weight:800;border:1px solid #2a365f;flex:0 0 28px"; rail.appendChild(more); }
    if(count<=5){ const av = makeAvatar(avatarUrl,name); if(uid) try{ av.dataset.uid = uid; }catch{} rail.insertBefore(av, more); more.style.display="none"; }
    else { more.textContent="+"+(count-5); more.style.display="flex"; }
  }
  function renderOptions(opts){
    const keys=["A","B","C","D"]; const list=$("#km-ans"); if(!list) return;
    list.innerHTML=""; ansCounts=[0,0,0,0];
    opts.forEach((t,i)=>{
      const row=document.createElement("div"); row.className="choice"; row.dataset.idx=String(i);
      row.style.cssText="display:grid;grid-template-columns:48px minmax(0,1fr) minmax(150px,42%);align-items:center;gap:8px;border:1px solid #263154;background:#0d1327;border-radius:14px;padding:10px 12px;min-height:48px";
      row.innerHTML = `
        <div class="key" style="width:28px;height:28px;border-radius:8px;background:#1a2443;display:flex;align-items:center;justify-content:center;font-weight:900">${keys[i]}</div>
        <div class="txt" style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t||"—"}</div>
        <div class="rail" style="display:flex;align-items:center;gap:6px;flex-wrap:nowrap;justify-content:flex-end;min-width:150px;max-width:100%;overflow:hidden;white-space:nowrap;contain:layout paint style;transform:translateZ(0)"></div>`;
      list.appendChild(row);
    });
  }

  // ---------- Flow ----------
  function blacklistCurrent(){
    if(phase !== "play") return;
    if(!currentQuestion || !currentQuestion.itemId) return;
    const itemId = String(currentQuestion.itemId);
    if(blacklist.has(itemId)) return;
    blacklist.add(itemId);
    saveBlacklist();
    pool = pool.filter(entry => String(entry.item||"") !== itemId);
    if(currentQuestion.countryId) used.delete(currentQuestion.countryId);
    notify("Klausimas pasalintas is banko.");
    clearChatGuard();
    stopHud();
    perQ[qIdx-1] = null;
    currentQuestion = null;
    setTimeout(()=>{ Promise.resolve(showQ()).catch(()=>{}); }, 60);
  }

  async function showQ(){
    $("#km-live").style.display="grid"; $("#km-break").style.display="none"; phase="play";
    await ensurePool();
    const q = pickQuestion();
    if(!q){
      notify("Nebera nauju klausimu.");
      finishEvent();
      return;
    }
    currentQuestion = q;
    options = q.opts; correctKey = q.correctKey;
    perQ[qIdx-1] = { correctKey, options:[...options], answers:[] };

    const mediaImg = document.getElementById("km-media-img");
    if(mediaImg){
      mediaImg.src = q.media;
      mediaImg.alt = q.correctCountry || "pinigai";
    }else{
      $("#km-media").innerHTML = `
        <button id="km-hide" title="Paslėpti klausimą" style="position:absolute;top:10px;right:10px;border:1px solid rgba(255,255,255,.25);background:rgba(15,22,45,.75);color:#cfe0ff;border-radius:999px;padding:4px 8px;font-size:12px;opacity:.55;cursor:pointer;z-index:2">×</button>
        <img id="km-media-img" src="${q.media}" alt="pinigai" style="width:100%;max-height:56vh;object-fit:contain;opacity:.97">`;
      const hideBtn = document.getElementById("km-hide");
      if(hideBtn){
        hideBtn.addEventListener("click",(ev)=>{
          ev.preventDefault();
          ev.stopPropagation();
          blacklistCurrent();
        });
        hideBtn.addEventListener("mouseenter",()=>hideBtn.style.opacity="1");
        hideBtn.addEventListener("mouseleave",()=>hideBtn.style.opacity="0.55");
      }
    }
    renderOptions(options);

    setChatGuard((msg)=>{
      if(phase!=="play") return false;
      const key = (msg.parsedAnswer || parseAnswer(String(msg.text||"")));
      if(!key) return false;
      const idx=["A","B","C","D"].indexOf(key); if(idx<0) return true;
      const name=msg.displayName||msg.user?.nickname||"Zaidejas";
      const uid = (msg.user && (msg.user.userId || msg.user.uniqueId)) || norm(name);
      const rec = perQ[qIdx-1] || (perQ[qIdx-1]={correctKey, options:[...options], answers:[]});
      if(rec.answers.some(a=>a.uid===uid)) return true;
      const avatar=msg.profilePicture||msg.profilePictureUrl||msg.user?.profilePicture||msg.user?.profilePictureUrl||"";
      const ms=performance.now()-startMs;
      const ok = key===correctKey;
      rec.answers.push({uid,name,key,ok,ms,avatar});
      addToRail(idx, avatar, name, uid);
      const agg=totals.get(uid)||{name,corrects:0,totalMs:0,answers:[],avatar};
      if(ok){ agg.corrects++; agg.totalMs+=ms; }
      agg.answers.push({q:qIdx, ms, ok}); agg.avatar=avatar||agg.avatar; totals.set(uid,agg);
      return true;
    });

    startMs=performance.now();
    hudLeft=$("#km-left");
    hudFill=$("#km-fill");
    startHud();
  }
  function reveal(){
    phase="break"; stopHud(); clearChatGuard();
    const keys=["A","B","C","D"]; const idx=keys.indexOf(correctKey);
    const row=document.querySelector(`#km-ans .choice[data-idx="${idx}"]`);
    if(row){ row.style.outline="2px solid #2b6b43"; row.classList.add("correct"); }
    $("#km-break-msg").innerHTML = (qIdx < cfg.questions)
      ? `Teisinga šalis: <span class="kudos">${options[idx]}</span>. Paspausk „Kitas klausimas“.`
      : `Teisinga šalis: <span class="kudos">${options[idx]}</span>. Paspausk „Baigti“.`;
    const btn = $("#km-next"); if(btn){ btn.textContent = (qIdx < cfg.questions) ? "Kitas klausimas" : "Baigti"; btn.disabled=true; }
    $("#km-break").style.display="flex";
    setTimeout(()=>{ if(btn) btn.disabled=false; btn.onclick=()=>{ if(qIdx < cfg.questions){ qIdx++; showQ(); } else { finishEvent(); } }; }, cfg.breakMs);
  }

  // ---------- Robust awarding ----------
  function findPlayerIdByName(name){
    const players = KQuiz.state?.players || {};
    const key = norm(name);
    let pid = Object.keys(players).find(id => norm(players[id]?.name) === key);
    if(!pid && window.KQ_NameToId && KQ_NameToId[key]) pid = KQ_NameToId[key];
    return pid || null;
  }
  function grant(name, pts, avatar){
    const players = KQuiz.state.players || (KQuiz.state.players = {});
    let pid = findPlayerIdByName(name);
    if(!pid){
      pid = "auto_"+Math.random().toString(36).slice(2);
      players[pid] = { name, score: 0, nextMilestone: 100, avatar: avatar||"" };
    }
    const before = Number(players[pid].score||0);
    players[pid].score = before + pts;
    try{ KQuiz.emit("scoresChanged",{ id:pid, before, after:players[pid].score, player:players[pid], correct:true }); }catch{}
  }

  function tableModal(rows, winners){
    const modal=document.createElement("div");
    modal.id="km-result-modal";
    modal.style.cssText="position:fixed;inset:0;z-index:10050;background:rgba(5,8,14,.8);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:12px";
    const thQ = Array.from({length: cfg.questions}, (_,i)=>`<th>Q${i+1}</th>`).join("");
    const trs = rows.map((r,i)=>{
      const seq = Array.from({length: cfg.questions}, (_,qi)=>{
        const a = r.answers.find(t=>t.q===qi+1);
        if(!a) return `<td>—</td>`;
        if(!a.ok) return `<td style="color:#ff5964">×</td>`;
        return `<td style="color:#3bd671">${(a.ms/1000).toFixed(2)}s</td>`;
      }).join("");
      const award = winners.some(w=>w.uid===r.uid) ? ` <span style="color:#ffd166">+${cfg.bonus}</span>` : "";
      return `<tr>
        <td>${i+1}</td>
        <td style="display:flex;align-items:center;gap:6px">${r.avatar?`<img src="${r.avatar}" referrerpolicy="no-referrer" style="width:28px;height:28px;border-radius:50%">`:""} ${r.name}</td>
        <td>${r.corrects}</td><td>${(r.totalMs/1000).toFixed(2)}s</td><td>${r.corrects? (r.avg/1000).toFixed(2)+"s":"—"}</td>
        ${seq}
        <td>${award}</td>
      </tr>`;
    }).join("");

    modal.innerHTML = `
      <div style="width:min(1100px,100%);max-height:90vh;overflow:auto;border:1px solid #273149;border-radius:16px;background:#0b1124;box-shadow:0 24px 60px rgba(0,0,0,.5)">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #1e2a35">
          <div id="km-winner" style="font-weight:900;letter-spacing:.5px"></div>
          <div><button id="km-close2" style="cursor:pointer;border:1px solid #2a365f;background:#121a35;color:#cfe0ff;border-radius:999px;padding:8px 12px;font-weight:700">Grįžti į žaidimą</button></div>
        </div>
        <div id="km-rules" class="sub" style="padding:10px 14px;border-bottom:1px solid #1e2a35"></div>
        <div id="km-table" style="padding:10px 14px">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr><th>#</th><th>Žaidėjas</th><th>✓</th><th>Bendra</th><th>Vid.</th>${thQ}<th>+</th></tr></thead>
            <tbody>${trs||"<tr><td colspan='99'>—</td></tr>"}</tbody>
          </table>
        </div>
      </div>`;
    document.body.appendChild(modal);
    return modal;
  }

  function finishEvent(){
    currentQuestion = null;
    clearChatGuard(); stopHud();
    const rows=[...totals.entries()].map(([uid,v])=>({uid, name:v.name, corrects:v.corrects,totalMs:v.totalMs,avg:v.corrects? v.totalMs/v.corrects : 0, avatar:v.avatar||"", answers:v.answers}))
      .sort((a,b)=> b.corrects-a.corrects || a.totalMs-b.totalMs);
    let winners = rows.filter(r=>r.corrects===cfg.questions);
    if((!winners || winners.length===0) && rows.length){ winners = [rows[0]]; }

    winners.forEach(w => grant(w.name, cfg.bonus, w.avatar));

    const modal = tableModal(rows, winners);
    $("#km-rules").textContent = `Taisyklės: atspėk šalį pagal banknotą/monetą. Visi 5/5 gauna +${cfg.bonus}.`;
    $("#km-winner").innerHTML = (rows.length ? winners.length : 0)
      ? (winners.length>1
         ? `Nugalėtojai (${winners.length}): ${winners.map(w=>`<strong>${w.name}</strong>`).join(", ")} • +${cfg.bonus}`
         : `Nugalėtojas: <strong>${winners[0].name}</strong> • +${cfg.bonus}`)
      : (rows.length? "Nėra nugalėtojo pagal taisykles, priskirtas geriausias pagal reitingą." : "Nėra nugalėtojo.");

    $("#km-close2").onclick = ()=>{ hardClose(); };
  }

  function hardClose(){
    active=false; phase="idle";
    currentQuestion = null;
    stopHud(); clearChatGuard();
    try{ document.getElementById('km-tick')?.pause(); }catch{}
    try{ document.getElementById("km-result-modal")?.remove(); }catch{}
    try{ document.getElementById("kq-money-overlay")?.remove(); }catch{}
    try{ resumeFlow(); }catch{}
    releaseLock();
  }

  // ---------- Start / trigger ----------
  async function startInline(){
    if(active) return;
    if(!acquireLock()) { console.warn("[money-inline] start skipped, another mini active"); return; }
    active=true; phase="intro"; qIdx=1; used.clear(); perQ.length=0; totals.clear();
    pauseMain(); mountOverlay(); await ensurePool();
  }

  // fire only on 5/15/25…
  let lastBlock=-1;
  function onQuestionEnd(){
    if(!enabled || active) return;
    const done = (KQuiz.state?.session?.done|0) + 1;
    // fire only on 5,15,25,35…
    if(done % 10 === 5){
      const block = Math.floor(done/10);
      if(block !== lastBlock){
        lastBlock = block;
        try{ KQuiz.control && KQuiz.control.pauseMain && KQuiz.control.pauseMain(); }catch{}
        setTimeout(()=> startInline(), (cfg && cfg.revealHoldMs) || 1200);
      }
    }
  }


  KQuiz.registerAddon({
    id: ADDON_ID,
    name: "Pinigai (banknotai/monetos) — mini žaidimas v1.0.4",
    description: "Wikidata/Commons base, 5/15/25.., vienas atsakymas žaidėjui, +50 nugalėtojui.",
    defaultEnabled: true,
    enable(){ enabled=true; KQuiz.on("questionEnd", onQuestionEnd); },
    disable(){ enabled=false; KQuiz.off("questionEnd", onQuestionEnd); if(active) hardClose(); }
  });

  // public handle
  window.KQ_Money = { start: startInline, close: hardClose, blacklist: blacklistCurrent };
})();








