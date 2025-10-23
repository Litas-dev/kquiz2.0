/*!
 * KQuiz add-on: Lokatoriaus žemėlapis — RELIABLE LEGACY (v2.3.1.locked, right-rail)
 * Change: avatar rail moved to the RIGHT of each answer card (not under text).
 * Also: fixed-height cards; overflow hidden; max rail width; keeps all logic.
 */
(function(){
  "use strict";
  if(!window.KQuiz || !KQuiz.registerAddon || !KQuiz.util || !KQuiz.control){
    console.warn("[map-inline] KQuiz core not ready."); return;
  }

  // ---------- Global lock ----------
  const ADDON_ID = "map-inline";
  function acquireLock(id){
    if(!window.KQ_MINI_LOCK){ window.KQ_MINI_LOCK = { held:false, by:null }; }
    if(window.KQ_MINI_LOCK.held && window.KQ_MINI_LOCK.by && window.KQ_MINI_LOCK.by!==id) return false;
    window.KQ_MINI_LOCK.held = true; window.KQ_MINI_LOCK.by = id; return true;
  }
  function releaseLock(id){
    if(window.KQ_MINI_LOCK && window.KQ_MINI_LOCK.by===id){ window.KQ_MINI_LOCK.held=false; window.KQ_MINI_LOCK.by=null; }
  }

  // ---------- Config ----------
  const cfg = {
    revealHoldMs: 1200,
    questions: 5,
    secPerQ: 25,
    bonus: 50,
    breakMs: 1200,
    poolLimit: 800,
    imageWidth: 900,
    awardAllPerfect: true
  };

  // ---------- State ----------
  let enabled = true, active = false, qIdx = 0;
  let pool=[], used=new Set();
  let startMs=0, hudLeft=null, hudFill=null, hudTick=null;
  let correctKey="A", options=[], currentPick=null, phase="idle";
  let ansCounts = [0,0,0,0];
  const perQ = [];                 // per question answers
  const totals = new Map();        // uid -> agg

  const { $, shuffle, parseAnswer } = KQuiz.util;
  const { pauseMain, resumeFlow, setChatGuard, clearChatGuard } = KQuiz.control;

  // ---------- Net helpers ----------
  async function fetchJSON(url, {timeout=8000, headers} = {}){
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), timeout);
    try{
      const r = await fetch(url, {signal: ctrl.signal, headers: headers || {'Accept':'application/sparql-results+json,*/*'}});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    }finally{ clearTimeout(t); }
  }
  async function retry(fn, tries=3, base=700){
    let last;
    for(let i=0;i<tries;i++){
      try{ return await fn(); }catch(e){ last=e; await new Promise(r=>setTimeout(r, base*Math.pow(2,i))); }
    }
    throw last;
  }
  const commonsPath = (title, w)=>{
    const file = String(title||"").replace(/^File:/i,"");
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${w|0||900}`;
  };
  const MW = (lang, titles)=>`https://${lang}.wikipedia.org/w/api.php?action=query&prop=pageimages|images&piprop=original|thumbnail&pithumbsize=${cfg.imageWidth}&format=json&origin=*&titles=${encodeURIComponent(titles)}`;
  const WQ = (q)=>"https://query.wikidata.org/sparql?format=json&query="+encodeURIComponent(q);

  // ---------- Data (countries with locator map P242) ----------
  async function ensurePool(){
    if(pool.length) return;
    const q=`SELECT ?c ?cLabel ?map WHERE {
      ?c wdt:P31 wd:Q3624078 ; wdt:P242 ?map .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "lt,en". }
    } LIMIT ${cfg.poolLimit}`;
    const data = await retry(()=>fetchJSON(WQ(q), {timeout:8000}), 3, 800);
    const rows = (data?.results?.bindings||[]);
    pool = rows.map(b=>{
      const id = (b.c?.value||"").split("/").pop();
      const lt = b.cLabel?.value||"";
      const map = b.map?.value||"";
      return { id, name: lt, imgFile: decodeURIComponent(map.split("/").pop()) };
    }).filter(x=>x.id && x.name && x.imgFile);
    shuffle(pool);
  }

  async function neighborsOf(qid){
    const q = `SELECT ?n ?nLabel WHERE { wd:${qid} wdt:P47 ?n . ?n wdt:P31 wd:Q3624078 . SERVICE wikibase:label { bd:serviceParam wikibase:language "lt,en". } } LIMIT 64`;
    try{
      const d=await retry(()=>fetchJSON(WQ(q), {timeout:7000}), 2, 700);
      return (d?.results?.bindings||[]).map(b=>({id:b.n.value.split("/").pop(), name:b.nLabel.value}));
    }catch{ return []; }
  }
  async function sameContinentOf(qid, limit=128){
    const q = `SELECT ?n ?nLabel WHERE { wd:${qid} wdt:P30 ?cont . ?n wdt:P31 wd:Q3624078 ; wdt:P30 ?cont . FILTER(?n != wd:${qid}) SERVICE wikibase:label { bd:serviceParam wikibase:language "lt,en". } } LIMIT ${limit}`;
    try{
      const d=await retry(()=>fetchJSON(WQ(q), {timeout:7000}), 2, 700);
      return (d?.results?.bindings||[]).map(b=>({id:b.n.value.split("/").pop(), name:b.nLabel.value}));
    }catch{ return []; }
  }

  async function resolveImage(pick){
    if(pick?.imgFile) return commonsPath(pick.imgFile, cfg.imageWidth);
    try{
      const lt = await retry(()=>fetchJSON(MW("lt", pick.name), {timeout:6000}), 2, 600).catch(()=>null);
      const ltp = lt && Object.values(lt.query?.pages||{})[0];
      if(ltp?.thumbnail?.source) return ltp.thumbnail.source;
      const en = await retry(()=>fetchJSON(MW("en", pick.name), {timeout:6000}), 2, 600).catch(()=>null);
      const enp = en && Object.values(en.query?.pages||{})[0];
      if(enp?.thumbnail?.source) return enp.thumbnail.source;
    }catch{}
    return 'data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="100%" height="100%" fill="#0b1124"/><text x="50%" y="50%" fill="#9fb0d6" font-family="sans-serif" font-size="24" text-anchor="middle">Nerastas žemėlapis</text></svg>');
  }

  async function buildQ(){
    const avail = pool.filter(x=>!used.has(x.id));
    currentPick = avail.length ? avail[(Math.random()*avail.length)|0] : pool[(Math.random()*pool.length)|0];
    used.add(currentPick.id);

    let cands = await neighborsOf(currentPick.id);
    if(cands.length<3){ const more = await sameContinentOf(currentPick.id, 128); cands = cands.concat(more); }
    const set = new Set([currentPick.name]);
    const distract = [];
    shuffle(cands).forEach(c=>{ const nm=(c.name||"").trim(); if(nm && !set.has(nm)){ set.add(nm); distract.push(nm); } });
    if(distract.length<3){ shuffle(pool).forEach(x=>{ if(distract.length<3 && !set.has(x.name)){ set.add(x.name); distract.push(x.name); } }); }

    const keys=["A","B","C","D"];
    let opts = [currentPick.name, ...distract.slice(0,3)];
    const seen = new Set(); opts = opts.filter(nm=>{ if(!nm||seen.has(nm)) return false; seen.add(nm); return true; }).slice(0,4);
    if(!opts.includes(currentPick.name)){ opts[opts.length-1] = currentPick.name; }
    opts = shuffle(opts);
    const idx = opts.indexOf(currentPick.name);
    const media = await resolveImage(currentPick);
    return { media, opts, correctKey: keys[idx] };
  }

  // ---------- UI ----------
  function mountOverlay(){
    const overlay = document.createElement("div");
    overlay.id="kq-map-overlay";
    overlay.style.cssText="position:fixed;inset:0;background:rgba(7,10,18,.96);z-index:10040;display:flex;align-items:center;justify-content:center;padding:12px";
    const introImg=(()=>{ try{ if(window.KQ_ASSETS?.image) return window.KQ_ASSETS.image("map.png"); }catch{} return "assets/images/map.png"; })();
    overlay.innerHTML = `
      <div style="width:min(1060px,100%);display:grid;gap:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div style="font-weight:900;letter-spacing:.6px">Lokatoriaus žemėlapis</div>
          <div style="display:flex;align-items:center;gap:8px">
            <div id="kq-left" class="pill" style="min-width:40px;text-align:center">${cfg.secPerQ}</div>
            <div class="progress" style="width:220px;height:10px;border-radius:999px;background:#121a35;overflow:hidden">
              <i id="kq-fill" style="display:block;height:100%;width:0;background:linear-gradient(90deg,#ff5964,#3bd671)"></i>
            </div>
          </div>
        </div>

        <!-- Intro -->
        <div id="kq-intro" style="display:grid;gap:12px;border:1px solid #273149;border-radius:14px;background:#0b1124;padding:12px">
          <div class="cover" style="display:flex;align-items:center;justify-content:center;border:1px solid #233154;border-radius:12px;overflow:hidden;background:#091124;min-height:200px">
            <img src="" alt="fun" onerror="this.style.display='none'" style="max-width:100%;max-height:46vh;object-fit:contain;opacity:.95">
          </div>
          <div class="sub" style="color:#cfe0ff">
            <strong>Taisyklės:</strong> 5 klausimai. Rašyk A/B/C/D. Vienas atsakymas vienam žaidėjui.
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px">
            <button id="kq-start" style="cursor:pointer;border:1px solid #2a365f;background:linear-gradient(180deg,#0f162d,#0b1022);color:#cfe0ff;border-radius:999px;padding:10px 18px;font-weight:800">Tęsti</button>
          </div>
        </div>

        <!-- Live -->
        <div id="kq-live" style="display:none;gap:10px">
          <div id="kq-media" style="width:100%;border:1px solid #233154;border-radius:12px;overflow:hidden;background:#0b1124;display:flex;align-items:center;justify-content:center;min-height:220px">
            <div class="spinner" style="width:28px;height:28px;border-radius:50%;border:3px solid #273149;border-top-color:#8ab4ff;animation:spin 1s linear infinite"></div>
            <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
          </div>
          <div id="kq-ans" style="display:grid;gap:10px"></div>
          <div id="kq-break" style="display:none;align-items:center;justify-content:space-between;gap:10px;border:1px dashed #2a365f;border-radius:12px;padding:10px;background:#0c1224">
            <div id="kq-break-msg" class="sub">—</div>
            <button id="kq-next" style="cursor:pointer;border:1px solid #2a365f;background:linear-gradient(180deg,#0f162d,#0b1022);color:#cfe0ff;border-radius:999px;padding:10px 16px;font-weight:700;box-shadow:0 10px 24px rgba(0,0,0,.35);">Kitas klausimas</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    try{ overlay.querySelector(".cover img").src = introImg; }catch{}

    overlay.querySelector("#kq-start").onclick=()=>{
      $("#kq-intro").style.display="none";
      $("#kq-live").style.display="grid";
      phase="play";
      showQ();
    };
  }
  function unmountOverlay(){ document.getElementById("kq-map-overlay")?.remove(); }

  function setHud(sec){ if(hudLeft) hudLeft.textContent=String(Math.max(0,sec)); const t=cfg.secPerQ; const pct=t?(100*(t-sec)/t):0; if(hudFill) hudFill.style.width=pct+"%"; }
  function startHud(){
    const endAt=performance.now()+cfg.secPerQ*1000;
    hudLeft=$("#kq-left"); hudFill=$("#kq-fill"); setHud(cfg.secPerQ);
    try{ $("#tickAudio")?.play(); }catch{}
    if(hudTick) clearInterval(hudTick);
    hudTick=setInterval(()=>{ const left=Math.max(0,Math.ceil((endAt-performance.now())/1000)); setHud(left); if(left<=0){ clearInterval(hudTick); hudTick=null; reveal(); } },200);
  }
  function stopHud(){ try{ $("#tickAudio")?.pause(); }catch{} if(hudTick){ clearInterval(hudTick); hudTick=null; } }

  // Avatars rail
  function makeAvatar(url,name){
    if(url){ const img=document.createElement("img"); img.src=url; img.referrerPolicy="no-referrer"; img.style.cssText="width:28px;height:28px;border-radius:50%;object-fit:cover;border:1px solid #2a365f;box-shadow:0 2px 6px rgba(0,0,0,.3);flex:0 0 28px"; img.alt=name||""; img.className="kq-av kquiz-avatar"; return img; }
    const d=document.createElement("div"); d.textContent=(name||"?").trim().charAt(0).toUpperCase()||"•"; d.style.cssText="width:28px;height:28px;border-radius:50%;background:#1b2544;color:#cfe0ff;display:flex;align-items:center;justify-content:center;font-weight:900;border:1px solid #2a365f;flex:0 0 28px"; d.className="kq-av"; return d;
  }
  function addToRail(idx, avatarUrl, name, uid){
    const rail=document.querySelector(`#kq-ans .choice[data-idx="${idx}"] .rail`);
    if(!rail) return;
    if(uid){ const exists = rail.querySelector(`[data-uid="${uid}"]`); if(exists) return; }
    if(!rail) return;
    ansCounts[idx]=(ansCounts[idx]||0)+1; const count=ansCounts[idx];
    let more=rail.querySelector(".more-bubble");
    if(!more){ more=document.createElement("div"); more.className="more-bubble"; more.style.cssText="display:none;width:28px;height:28px;border-radius:50%;background:#1b2a4a;color:#cfe0ff;display:flex;align-items:center;justify-content:center;font-weight:800;border:1px solid #2a365f;flex:0 0 28px"; rail.appendChild(more); }
    if(count<=5){ const av = makeAvatar(avatarUrl,name); try{ if(uid && av) av.dataset.uid = uid; if(av) av.setAttribute("data-name", name||""); }catch{} rail.insertBefore(av, more); more.style.display="none"; }
    else { more.textContent="+"+(count-5); more.style.display="flex"; }
  }

  function renderOptions(opts){
    const keys=["A","B","C","D"]; const list=$("#kq-ans"); if(!list) return;
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

  // Flow
  async function showQ(){
    try{
      $("#kq-live").style.display="grid"; $("#kq-break").style.display="none"; phase="play";
      await ensurePool();
      const q = await retry(()=>buildQ(), 2, 600);
      options=q.opts; correctKey=q.correctKey;
      perQ[qIdx-1] = { correctKey, options:[...options], answers:[] };

      const cont = $("#kq-media");
      const img = new Image();
      img.referrerPolicy="no-referrer";
      img.style.cssText="width:100%;max-height:56vh;object-fit:contain;opacity:.97";
      img.onload = ()=>{ const sp=cont.querySelector('.spinner'); if(sp) sp.style.display='none'; };
      img.onerror = ()=>{ const sp=cont.querySelector('.spinner'); if(sp) sp.style.display='none'; };
      img.src = q.media;
      cont.innerHTML=""; cont.appendChild(img);

      renderOptions(options);

      setChatGuard((msg)=>{
        if(phase!=="play") return false;
        const key = (msg.parsedAnswer || parseAnswer(String(msg.text||"")));
        if(!key) return false;
        const idx=["A","B","C","D"].indexOf(key); if(idx<0) return true;
        const name=msg.displayName||msg.user?.nickname||"Žaidėjas";
        const uid = (msg.user && (msg.user.userId || msg.user.uniqueId)) || (name||"").toLowerCase();
        const avatar=msg.profilePicture||msg.profilePictureUrl||msg.user?.profilePicture||msg.user?.profilePictureUrl||"";
        const rec = perQ[qIdx-1];
        if(rec.answers.some(a=>a.uid===uid)) return true; // one answer each
        const ms=performance.now()-startMs;
        const ok = key===correctKey;
        rec.answers.push({uid,name,key,ok,ms,avatar});
        addToRail(idx, avatar, name, uid);
        const agg=totals.get(uid)||{name,corrects:0,totalMs:0,answers:[],avatar};
        if(ok){ agg.corrects++; agg.totalMs+=ms; }
        agg.answers.push({q:qIdx, ms, wrong:!ok}); agg.avatar=avatar||agg.avatar; totals.set(uid,agg);
        return true;
      });

      startMs=performance.now(); startHud();
    }catch(e){
      console.warn("[map-inline] showQ failed, skipping question", e);
      qIdx++;
      if(qIdx<=cfg.questions){ showQ(); } else { finishEvent(); }
    }
  }

  function reveal(){
    phase="break"; stopHud(); clearChatGuard();
    const keys=["A","B","C","D"]; const idx=keys.indexOf(correctKey);
    const row=document.querySelector(`#kq-ans .choice[data-idx="${idx}"]`);
    if(row){ row.style.outline="2px solid #2b6b43"; row.classList.add("correct"); }
    $("#kq-break-msg").innerHTML = (qIdx < cfg.questions)
      ? `Teisingas: <span class="kudos">${options[idx]}</span>. Paspausk „Kitas klausimas“.`
      : `Teisingas: <span class="kudos">${options[idx]}</span>. Paspausk „Baigti“.`;
    const btn = $("#kq-next"); if(btn){ btn.textContent = (qIdx < cfg.questions) ? "Kitas klausimas" : "Baigti"; btn.disabled=true; }
    $("#kq-break").style.display="flex";
    setTimeout(()=>{ if(btn) btn.disabled=false; btn.onclick=()=>{ if(qIdx <= cfg.questions) showQ(); else finishEvent(); }; }, cfg.breakMs);
    qIdx++;
  }

  function resultModal(rows, winners){
    const modal=document.createElement("div");
    modal.id="kq-result-modal";
    modal.style.cssText="position:fixed;inset:0;z-index:10050;background:rgba(5,8,14,.8);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:12px";
    const thQ = Array.from({length: cfg.questions}, (_,i)=>`<th>Q${i+1}</th>`).join("");
    const trs = rows.map((r,i)=>{
      const seq = Array.from({length: cfg.questions}, (_,qi)=>{
        const a = r.answers.find(t=>t.q===qi+1);
        if(!a) return `<td>—</td>`;
        if(a.wrong) return `<td style="color:#ff5964">×</td>`;
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
          <div id="kq-winner" style="font-weight:900;letter-spacing:.5px"></div>
          <div><button id="kq-close2" style="cursor:pointer;border:1px solid #2a365f;background:#121a35;color:#cfe0ff;border-radius:999px;padding:8px 12px;font-weight:700">Grįžti į žaidimą</button></div>
        </div>
        <div id="kq-rules" class="sub" style="padding:10px 14px;border-bottom:1px solid #1e2a35"></div>
        <div id="kq-table" style="padding:10px 14px">
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
    stopHud(); clearChatGuard();
    const rows=[...totals.entries()].map(([uid,v])=>({uid, name:v.name, corrects:v.corrects,totalMs:v.totalMs,avg:v.corrects? v.totalMs/v.corrects : 0, avatar:v.avatar||"", answers:v.answers}))
      .sort((a,b)=> b.corrects-a.corrects || a.totalMs-b.totalMs);
    let winners = cfg.awardAllPerfect ? rows.filter(r=>r.corrects===cfg.questions) : (rows[0]? [rows[0]] : []);
    if((!winners || winners.length===0) && rows.length){ winners = [rows[0]]; }

    winners.forEach(w=>{
      const pid = Object.keys(KQuiz.state.players||{}).find(pid=>KQuiz.state.players[pid]?.name===w.name) || w.uid;
      const before=(KQuiz.state.players?.[pid]?.score)||0;
      if(!KQuiz.state.players[pid]) KQuiz.state.players[pid]={ name:w.name, score:before, nextMilestone:100, avatar:w.avatar||"" };
      KQuiz.state.players[pid].score=before+cfg.bonus;
      try{ KQuiz.emit("scoresChanged",{ id:pid, before, after:KQuiz.state.players[pid].score, player:KQuiz.state.players[pid], correct:true }); }catch{}
    });

    const modal = resultModal(rows, winners);
    const rules = `Taisyklės: pirma teisingų kiekis (max ${cfg.questions}), tada bendra reakcijos trukmė. ${cfg.awardAllPerfect ? "Visi su 5/5 gauna taškus." : "Tik vienas nugalėtojas."}`;
    $("#kq-rules").textContent = rules;
    $("#kq-winner").innerHTML = (rows.length ? winners.length : 0)
      ? (winners.length>1
         ? `Nugalėtojai (${winners.length}): ${winners.map(w=>`<strong>${w.name}</strong>`).join(", ")} • +${cfg.bonus}`
         : `Nugalėtojas: <strong>${winners[0].name}</strong> • +${cfg.bonus}`)
      : (rows.length? "Nugalėtojas pagal taisykles neišrinktas, priskirtas geriausias pagal reitingą." : "Nėra nugalėtojo.");

    $("#kq-close2").onclick = ()=>{ hardClose(); };
  }

  function hardClose(){
    active=false; phase="idle";
    stopHud(); clearChatGuard();
    try{ document.getElementById("kq-result-modal")?.remove(); }catch{}
    try{ document.getElementById("kq-map-overlay")?.remove(); }catch{}
    try{ resumeFlow(); }catch{}
    releaseLock(ADDON_ID);
  }

  async function startInline(){
    if(active) return;
    if(!acquireLock(ADDON_ID)){ console.warn("[map-inline] start skipped; another mini active"); return; }
    active=true; phase="intro"; qIdx=1; used.clear(); perQ.length=0; totals.clear();
    pauseMain(); mountOverlay();
  }

  // ---------- Deterministic trigger on 10/20/30… ----------
  let lastBlock = -1;
  function onQuestionEnd(){
    if(!enabled || active) return;
    const done = (KQuiz.state?.session?.done|0) + 1;
    if(done>0 && done % 10 === 0){
      const block = Math.floor(done/10);
      if (block !== lastBlock) {
  lastBlock = block;
  try { KQuiz.control && KQuiz.control.pauseMain && KQuiz.control.pauseMain(); } catch {}
  setTimeout(() => { startInline(); }, cfg.revealHoldMs || 1200);
}

    }
  }

  KQuiz.registerAddon({
    id: "map-inline",
    name: "Lokatoriaus žemėlapis (v2.3.1 locked • right-rail)",
    description: "Avatarai į dešinę, fiksuotas aukštis, #10/20/30…, mini lock, intro, griežta pauzė.",
    defaultEnabled: true,
    enable(){ enabled=true; KQuiz.on("questionEnd", onQuestionEnd); },
    disable(){ enabled=false; KQuiz.off("questionEnd", onQuestionEnd); if(active) hardClose(); }
  });

  window.KQ_MapInline = { start: startInline, close: hardClose };
})();
