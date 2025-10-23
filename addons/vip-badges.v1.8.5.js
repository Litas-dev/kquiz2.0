/*!
 * KQuiz add-on: VIP Aura FX (v1.8.5)
 * Fix: drifting/lagging aura on animated avatars.
 * - Continuous rAF tracking of VIP targets while visible.
 * - Robust DOM cleanup; no accumulation.
 * - Integer snap to pixels to avoid subpixel creep.
 * - Keeps settings UI and glow/flame/trail visuals.
 */
(function(){
  "use strict";
  const CFG = { z: 99995, haloGrow: 8, trailEveryMs: 80, trailTTL: 520, trailMax: 5, sparksEveryMs: 1100, sparkTTL: 850, spinMs: 4200 };

  const norm = s => String(s||"").normalize('NFKD').replace(/\p{Diacritic}/gu,'').trim().toLowerCase().replace(/\s+/g," ");
  const loadList = (key) => { try{ return JSON.parse(localStorage.getItem(key)||"[]"); }catch{ return []; } };
  const saveList = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const STORAGE = { vip: "kq_vips", sub: "kq_subs" };
  const state = { vips: loadList(STORAGE.vip), subs: loadList(STORAGE.sub) };

  const byNameKey = (name)=> `nm:${norm(name)}`;
  const byIdKey   = (id)=> `id:${String(id)}`;
  const saveVIPs = ()=> saveList(STORAGE.vip, state.vips);
  const saveSUBs = ()=> saveList(STORAGE.sub, state.subs);

  const isVIP = (name, uid) => {
    const k1 = uid ? byIdKey(uid) : null;
    const k2 = name ? byNameKey(name) : null;
    return state.vips.some(v => (k1 && v.key===k1) || (k2 && v.key===k2));
  };
  const addVIPByName = (name)=>{
    const nm = String(name||"").trim(); if(!nm) return;
    const key = byNameKey(nm);
    if(!state.vips.some(v=>v.key===key)) state.vips.push({key, type:"name", name:nm});
    saveVIPs();
  };
  const removeVIP = (key)=>{ state.vips = state.vips.filter(v=>v.key!==key); saveVIPs(); };
  const isSUB = (name, uid) => {
    const k1 = uid ? byIdKey(uid) : null;
    const k2 = name ? byNameKey(name) : null;
    return state.subs.some(v => (k1 && v.key===k1) || (k2 && v.key===k2));
  };
  const addSUBByName = (name)=>{
    const nm = String(name||"").trim(); if(!nm) return;
    const key = byNameKey(nm);
    if(!state.subs.some(v=>v.key===key)) state.subs.push({key, type:"name", name:nm});
    saveSUBs();
  };
  const removeSUB = (key)=>{ state.subs = state.subs.filter(v=>v.key!==key); saveSUBs(); };

  // ---------- CSS ----------
  const CSS = `
  @media (prefers-reduced-motion:no-preference){
    @keyframes kqAuraPulse { 0%,100%{ opacity:.85; filter:blur(6px) } 50%{ opacity:1; filter:blur(9px) } }
    @keyframes kqTrailFade { 0%{ opacity:.42 } 100%{ opacity:0 } }
    @keyframes kqFlameSpin { 0%{ transform:rotate(0deg) } 100%{ transform:rotate(360deg) } }
    @keyframes kqSpark { 0%{ transform:scale(.6); opacity:0 } 10%{opacity:1} 100%{ transform:scale(1.2); opacity:0 } }
  }
  .kq-vip-ring, .kq-aura, .kq-flame, .kq-trail, .kq-spark{ position:fixed; left:-9999px; top:-9999px; pointer-events:none; z-index:${CFG.z}; }
  .kq-vip-ring{
    border-radius:999px;
    border:2px solid rgba(255,225,0,.85);
    box-shadow:0 0 14px rgba(255,225,0,.55);
    background:rgba(255,255,0,.06);
  }
  .kq-aura{
    border-radius:999px;
    box-shadow: 0 0 0 2px rgba(255,215,120,.65), 0 0 22px rgba(255,215,120,.45), 0 0 44px rgba(167,139,250,.25);
    background: radial-gradient(60% 60% at 50% 50%, rgba(255,225,150,.32) 0%, rgba(255,225,150,.1) 40%, rgba(0,0,0,0) 70%);
  }
  @media (prefers-reduced-motion:no-preference){ .kq-aura{ animation:kqAuraPulse 2600ms ease-in-out infinite } }
  .kq-flame{
    border-radius:999px;
    box-shadow: 0 0 32px rgba(255,150,60,.35), inset 0 0 18px rgba(255,200,120,.2);
    background:
      conic-gradient(from 0deg, rgba(255,90,0,.0) 0 10%, rgba(255,110,30,.35) 12%, rgba(255,180,80,.28) 18%, rgba(255,90,0,.0) 22%, rgba(255,90,0,.0) 100%),
      radial-gradient(60% 60% at 50% 50%, rgba(255,140,60,.18), rgba(0,0,0,0) 70%);
    mix-blend-mode: lighten;
  }
  @media (prefers-reduced-motion:no-preference){ .kq-flame{ animation:kqFlameSpin 4200ms linear infinite } }
  .kq-trail{ border-radius:999px; background: radial-gradient(60% 60% at 50% 50%, rgba(255,225,150,.28) 0%, rgba(255,225,150,.06) 40%, rgba(0,0,0,0) 70%); }
  @media (prefers-reduced-motion:no-preference){ .kq-trail{ animation:kqTrailFade 520ms ease-out forwards } }
  .kq-spark{ width:8px; height:8px; border-radius:50%; background: radial-gradient(circle at 30% 30%, #fff, #ffd166 40%, rgba(255,209,102,.2) 70%, rgba(0,0,0,0) 80%); box-shadow: 0 0 12px rgba(255,209,102,.75); }
  @media (prefers-reduced-motion:no-preference){ .kq-spark{ animation:kqSpark 850ms ease-out forwards } }
  /* Settings + FAB */
  #kq-vip-fab{ position:fixed; top:10px; right:10px; z-index:${CFG.z+1}; padding:6px 10px; border-radius:999px; border:1px solid #2a365f; background:#0f162d; color:#cfe0ff; opacity:.9 }
  #kq-vip-fab:hover{ opacity:1 }
  #kq-vip-modal{ position:fixed; inset:0; z-index:${CFG.z+2}; background:rgba(0,0,0,.55); display:flex; align-items:center; justify-content:center }
  #kq-vip-panel{ width:min(680px,92%); max-height:80vh; overflow:auto; border:1px solid #273149; border-radius:12px; background:#0b1124; padding:12px; color:#cfe0ff }
  .kq-row{ display:flex; align-items:center; gap:8px; padding:6px 8px; border-bottom:1px dashed #1e2435 }
  .kq-row:last-child{ border-bottom:none }
  .kq-sub{ color:#9fb0d6; font-size:12px }
  .kq-input{ padding:8px 10px; border:1px solid #2a365f; border-radius:10px; background:#0f162d; color:#cfe0ff; width:100% }
  .kq-btn{ padding:6px 10px; border-radius:10px; border:1px solid #2a365f; background:#0f162d; color:#cfe0ff }
  `;
  function ensureStyle(){ if(document.getElementById("kq-aura-style")) return; const s=document.createElement("style"); s.id="kq-aura-style"; s.textContent=CSS; document.head.appendChild(s); }

  // ---------- Overlays + tracking ----------
  const pool = new WeakMap();
  const tracked = new Set();
  let rafId = 0;

  function ensureOverlays(node){
    let o = pool.get(node);
    if(!o){
      const ring  = document.createElement("div"); ring.className  = "kq-vip-ring";
      const aura  = document.createElement("div"); aura.className  = "kq-aura";
      const flame = document.createElement("div"); flame.className = "kq-flame";
      document.body.appendChild(ring); document.body.appendChild(aura); document.body.appendChild(flame);
      o = { ring, aura, flame, trails:[], lastTrailAt:0, lastRect:null, lastSparkAt:0, role:null };
      pool.set(node, o);
    }
    return o;
  }
  function hidePos(el){ if(!el) return; el.style.left="-9999px"; el.style.top="-9999px"; }
  function clearTrails(o){ while(o?.trails?.length){ try{ o.trails.shift().remove(); }catch{} } }
  function hide(o){ if(!o) return; o.role=null; hidePos(o.ring); hidePos(o.aura); hidePos(o.flame); clearTrails(o); }
  function setRole(o, role){
    if(!o) return;
    if(o.role===role) return;
    if(role==="vip"){ hidePos(o.aura); hidePos(o.flame); clearTrails(o); }
    if(role==="sub"){ hidePos(o.ring); }
    o.role = role;
  }

  function spawnTrail(o, r){
    const now = performance.now();
    if(now - o.lastTrailAt < CFG.trailEveryMs) return;
    o.lastTrailAt = now;
    const t = document.createElement("div"); t.className="kq-trail";
    const g = CFG.haloGrow - 2;
    const w = Math.round(Math.max(0, r.width + g*2));
    const h = Math.round(Math.max(0, r.height + g*2));
    const x = Math.round(r.left - g);
    const y = Math.round(r.top  - g);
    t.style.width  = w + "px"; t.style.height = h + "px";
    t.style.left   = x + "px"; t.style.top    = y + "px";
    document.body.appendChild(t);
    o.trails.push(t);
    while(o.trails.length > CFG.trailMax){ try{ o.trails.shift().remove(); }catch{} }
    setTimeout(()=>{ try{ t.remove(); }catch{} }, CFG.trailTTL+50);
  }
  function spawnSpark(o, r){
    const now = performance.now();
    if(now - o.lastSparkAt < CFG.sparksEveryMs) return;
    o.lastTrailAt = now;
    const s = document.createElement("div"); s.className="kq-spark";
    const ang = Math.random()*Math.PI*2;
    const rad = Math.min(r.width, r.height)/2 + 8;
    const cx = r.left + r.width/2, cy = r.top + r.height/2;
    s.style.left = Math.round(cx + Math.cos(ang)*rad - 4) + "px";
    s.style.top  = Math.round(cy + Math.sin(ang)*rad - 4) + "px";
    document.body.appendChild(s);
    setTimeout(()=>{ try{ s.remove(); }catch{} }, CFG.sparkTTL+50);
  }
  function layout(node){
    const o = ensureOverlays(node);
    if(!o.role){ hide(o); return; }
    const r = node.getBoundingClientRect();
    const snap = v => Math.round(v);
    const dx = o.lastRect ? Math.abs(r.left - o.lastRect.left) : 999;
    const dy = o.lastRect ? Math.abs(r.top  - o.lastRect.top)  : 999;
    o.lastRect = { left:r.left, top:r.top, width:r.width, height:r.height };
    if(o.role === "sub"){
      if(dx+dy > 1.5) spawnTrail(o, r);
      const g = CFG.haloGrow;
      const w = snap(Math.max(0, r.width + g*2)), h = snap(Math.max(0, r.height + g*2));
      const x = snap(r.left - g), y = snap(r.top - g);
      hidePos(o.ring);
      o.aura.style.width=w+"px"; o.aura.style.height=h+"px"; o.aura.style.left=x+"px"; o.aura.style.top=y+"px";
      o.flame.style.width=w+"px"; o.flame.style.height=h+"px"; o.flame.style.left=x+"px"; o.flame.style.top=y+"px";
      spawnSpark(o, r);
    }else if(o.role === "vip"){
      clearTrails(o);
      hidePos(o.aura); hidePos(o.flame);
      const ringGrow = 6;
      const w = snap(Math.max(0, r.width + ringGrow*2));
      const h = snap(Math.max(0, r.height + ringGrow*2));
      const x = snap(r.left - ringGrow);
      const y = snap(r.top - ringGrow);
      o.ring.style.width=w+"px"; o.ring.style.height=h+"px"; o.ring.style.left=x+"px"; o.ring.style.top=y+"px";
    }
  }

  function tick(){
    rafId = 0;
    tracked.forEach(node=>{
      if(!node || !node.isConnected){
        const o = pool.get(node); if(o){ hide(o); pool.delete(node); }
        tracked.delete(node);
        return;
      }
      const o = pool.get(node);
      if(!o || !o.role){
        if(o) hide(o);
        tracked.delete(node);
        return;
      }
      layout(node);
    });
    if(tracked.size>0) rafId = requestAnimationFrame(tick);
  }
  function ensureTick(){
    if(rafId) return;
    if(tracked.size>0) rafId = requestAnimationFrame(tick);
  }

  // ---------- discovery ----------
  function inferNameFrom(node){
    const get = (el,attr)=> el && el.getAttribute && el.getAttribute(attr);
    const attrs = ["data-name","data-username","data-displayname","aria-label","title","alt"];
    for(const a of attrs){ const v = get(node,a); if(v && v.trim().length>=2) return v.trim(); }
    const parent = (node.closest && node.closest("[data-user],[data-player],.player,.lbItem,.row,.tile,.choice,.stack,.user,.entry,.line,.toast,.bubble,.flyover,.float")) || node.parentElement;
    if(parent){
      const cands = parent.querySelectorAll("[data-name],[data-username],[data-displayname],.name,.player-name,.username,.avName,.nm,figcaption,caption,[aria-label],.nick,.label,.title");
      for(const el of cands){
        const v = (el.getAttribute?.("data-name")||el.textContent||"").trim();
        if(v.length>=2) return v;
      }
    }
    return "";
  }
  const SELECTORS = [
    "#ans .choice img, .answers .choice img, .stack img",
    "#roundLB img, #seasonLB img, .leaderboard img, .lbList img, .lbList img.av",
    ".duel img.avatar, .kq-duel img, #dvAns img, #dvMedia img.avatar",
    "img.kq-av, img.kquiz-avatar, img[data-avatar], img[data-uid], img[referrerpolicy]",
    ".flyover .avatar, .fly .avatar, .float .avatar, .toast .avatar, .bubble .avatar",
    ".kq-fly img, [data-avatar], [data-avatar-url], .avatar, .pfp, .userpic",
    ".flyover [style*='background-image'], .fly [style*='background-image'], .float [style*='background-image']"
  ];
  function findTargets(){
    const out = new Set();
    try{ document.querySelectorAll(SELECTORS.join(",")).forEach(n=>out.add(n)); }catch{}
    for(const host of document.querySelectorAll("*")){
      if(host.shadowRoot){
        try{ host.shadowRoot.querySelectorAll(SELECTORS.join(",")).forEach(n=>out.add(n)); }catch{}
      }
    }
    return out;
  }
  function renderFor(node){
    try{
      const uid = node.dataset?.uid || node.getAttribute?.("data-uid") || node.getAttribute?.("data-user-id") || "";
      let name = node.getAttribute?.("data-name") || node.getAttribute?.("aria-label") || node.getAttribute?.("title") || (node.alt||"");
      if(!name || name.length<2) name = inferNameFrom(node);
      const sub = isSUB(name, uid);
      const vip = !sub && isVIP(name, uid);
      const overlays = ensureOverlays(node);
      if(sub){
        setRole(overlays, "sub");
        tracked.add(node);
        layout(node);
        ensureTick();
      }else if(vip){
        setRole(overlays, "vip");
        tracked.add(node);
        layout(node);
        ensureTick();
      }else{
        hide(overlays);
        tracked.delete(node);
      }
    }catch{}
  }

  // ---------- scanning ----------
  let moA=null, moB=null;
  function schedule(){
    const t = findTargets();
    t.forEach(renderFor);
    ensureTick();
  }
  // ---------- Settings panel ----------
  function renderPanel(container){
    container.innerHTML = "";
    const root = document.createElement("div"); root.style.display="grid"; root.style.gap="10px";
    const title = document.createElement("div"); title.textContent="VIP ir SUB žaidėjai"; title.style.fontWeight="900";
    const sub = document.createElement("div"); sub.className="kq-sub"; sub.textContent="Pažymėkite iš sąrašo arba pridėkite vardą. Saugojama naršyklėje.";
    const addRow = document.createElement("div"); addRow.style.display="grid"; addRow.style.gridTemplateColumns="1fr auto auto"; addRow.style.gap="8px";
    const input = document.createElement("input"); input.className="kq-input"; input.placeholder="Įrašykite vardą…";
    const addVipBtn = document.createElement("button"); addVipBtn.className="kq-btn"; addVipBtn.textContent="Pridėti VIP";
    const addSubBtn = document.createElement("button"); addSubBtn.className="kq-btn"; addSubBtn.textContent="Pridėti SUB";
    addVipBtn.onclick = ()=>{ const v=input.value.trim(); if(v){ addVIPByName(v); input.value=""; renderPanel(container); schedule(); } };
    addSubBtn.onclick = ()=>{ const v=input.value.trim(); if(v){ addSUBByName(v); input.value=""; renderPanel(container); schedule(); } };
    addRow.appendChild(input); addRow.appendChild(addVipBtn); addRow.appendChild(addSubBtn);

    const list = document.createElement("div"); list.style.cssText="border:1px solid #273149;border-radius:12px;max-height:320px;overflow:auto;padding:6px;background:#0b1124";

    const players = Object.entries((window.KQuiz&&KQuiz.state&&KQuiz.state.players)||{})
      .map(([id,p])=>({ id, name:p?.name||id, score:Number(p?.score)||0 }))
      .sort((a,b)=> b.score-a.score || a.name.localeCompare(b.name));

    if(players.length===0){
      const row = document.createElement("div"); row.className="kq-sub"; row.textContent="Nėra žaidėjų. Kai kas parašys chate, sąrašas atsiras.";
      list.appendChild(row);
    }else{
      players.forEach(p=>{
        const row = document.createElement("div"); row.className="kq-row";
        const keyId = byIdKey(p.id), keyNm = byNameKey(p.name);
        const nm = document.createElement("div"); nm.textContent = `${p.name} • ${p.score}`; nm.style.flex="1";

        const toggles = document.createElement("div"); toggles.style.display="flex"; toggles.style.alignItems="center"; toggles.style.gap="12px";

        const vipLabel = document.createElement("label"); vipLabel.style.display="flex"; vipLabel.style.alignItems="center"; vipLabel.style.gap="4px"; vipLabel.style.fontSize="12px";
        const vipCb = document.createElement("input"); vipCb.type="checkbox";
        vipCb.checked = state.vips.some(v=>v.key===keyId || v.key===keyNm);
        vipCb.onchange = ()=>{
          if(vipCb.checked){
            if(!state.vips.some(v=>v.key===keyId)) state.vips.push({key:keyId,type:"id",name:p.name});
          }else{
            state.vips = state.vips.filter(v=>v.key!==keyId && v.key!==keyNm);
          }
          saveVIPs(); schedule();
        };
        vipLabel.appendChild(vipCb);
        vipLabel.appendChild(document.createTextNode("VIP"));

        const subLabel = document.createElement("label"); subLabel.style.display="flex"; subLabel.style.alignItems="center"; subLabel.style.gap="4px"; subLabel.style.fontSize="12px";
        const subCb = document.createElement("input"); subCb.type="checkbox";
        subCb.checked = state.subs.some(v=>v.key===keyId || v.key===keyNm);
        subCb.onchange = ()=>{
          if(subCb.checked){
            if(!state.subs.some(v=>v.key===keyId)) state.subs.push({key:keyId,type:"id",name:p.name});
          }else{
            state.subs = state.subs.filter(v=>v.key!==keyId && v.key!==keyNm);
          }
          saveSUBs(); schedule();
        };
        subLabel.appendChild(subCb);
        subLabel.appendChild(document.createTextNode("SUB"));

        toggles.appendChild(vipLabel);
        toggles.appendChild(subLabel);

        const del = document.createElement("button"); del.className="kq-btn"; del.textContent="✕"; del.title="Pašalinti pagal vardą";
        del.onclick = ()=>{
          removeVIP(keyNm);
          removeSUB(keyNm);
          renderPanel(container);
          schedule();
        };
        row.appendChild(nm); row.appendChild(toggles); row.appendChild(del);
        list.appendChild(row);
      });
    }

    root.appendChild(title); root.appendChild(sub); root.appendChild(addRow); root.appendChild(list);
    container.appendChild(root);
  }

  function registerSettingsPanel(){
    let tries = 0;
    const max = 60; // ~30s
    (function loop(){
      try{
        if(KQuiz && KQuiz.settings && typeof KQuiz.settings.registerPanel==="function"){
          KQuiz.settings.registerPanel("vip-badges", "VIP ir SUB žaidėjai", renderPanel);
          return;
        }
      }catch{}
      if(++tries < max) setTimeout(loop, 500);
    })();
  }

  function ensureFab(){
    if(document.getElementById("kq-vip-fab")) return;
    const btn = document.createElement("button"); btn.id="kq-vip-fab"; btn.textContent="VIP"; btn.title="VIP sąrašas";
    btn.onclick = ()=>{
      const back = document.createElement("div"); back.id="kq-vip-modal";
      const panel = document.createElement("div"); panel.id="kq-vip-panel";
      back.appendChild(panel); document.body.appendChild(back);
      renderPanel(panel);
      back.addEventListener("click", (e)=>{ if(e.target===back) back.remove(); });
    };
    document.body.appendChild(btn);
  }

  // ---------- lifecycle ----------
  function enable(){
    ensureStyle();
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule, true);
    moA = new MutationObserver(schedule); moA.observe(document, {subtree:true, childList:true});
    moB = new MutationObserver(schedule); moB.observe(document, {subtree:true, attributes:true, attributeFilter:["src","style","data-uid","data-name","title","aria-label"]});
    schedule(); registerSettingsPanel(); ensureFab(); ensureTick();
  }
  function disable(){
    if(rafId){ cancelAnimationFrame(rafId); rafId=0; }
    tracked.clear();
  }

  if(!window.KQuiz || !KQuiz.registerAddon){ console.warn("[vip-aura] Load after core."); return; }
  KQuiz.registerAddon({
    id: "vip-badges",
    name: "VIP ženkliukai • Aura",
    description: "Aura/ugnies efektas aplink VIP avatarą. Su nustatymų skydeliu.",
    category: "Vizualizacija",
    configurable: true,
    showInSettings: true,
    defaultEnabled: true,
    enable, disable
  });

  window.KQ_VIP = Object.assign(window.KQ_VIP||{}, {
    scan: schedule,
    open(){ ensureFab(); document.getElementById('kq-vip-fab')?.click(); },
    isVip(uid, name){
      const kId = uid ? byIdKey(uid) : null;
      const kNm = name ? byNameKey(name) : null;
      return state.vips.some(v => (kId && v.key === kId) || (kNm && v.key === kNm));
    },
    isSub(uid, name){
      const kId = uid ? byIdKey(uid) : null;
      const kNm = name ? byNameKey(name) : null;
      return state.subs.some(v => (kId && v.key === kId) || (kNm && v.key === kNm));
    }
  });
})();
