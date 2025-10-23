/*!
 * KQuiz add-on: SharePoints (v1.3.0)
 * Fix: independent WS listener so load order no longer matters.
 * Server format supported (from your server.js):
 *   { type:"share", user:{...}, displayName:"Name", userId:"..." }
 * Awards +2 per share, with the same pause policy as v1.2.0 (score-only by default).
 */
(function(){
  "use strict";
  if(!window.KQuiz || !KQuiz.registerAddon || !KQuiz.util){ console.warn("[share-points] Load after core app.js"); return; }

  const { banner } = KQuiz.util;
  const norm = s => String(s||"").trim().toLowerCase();

  // -------- Settings --------
  function getMode(){
    const v = (localStorage.getItem("kq_share_pause_mode")||"scoreOnly").toLowerCase();
    return (v==="lockall"||v==="never"||v==="scoreonly") ? v : "scoreOnly";
  }
  function getCap(){
    const n = parseInt(localStorage.getItem("kq_share_cap")||"20",10);
    return isFinite(n) ? Math.max(0,n) : 20;
  }

  // -------- Pause logic --------
  let inScoreWindow = false;
  let pausedByLock  = false;
  try{
    if(KQuiz.on){
      KQuiz.on("revealStart", ()=>{ inScoreWindow = true; });
      KQuiz.on("questionStart", ()=>{ inScoreWindow = false; resetCaps(); });
      KQuiz.on("addonOpen", ()=>{ if(getMode()==="lockAll") pausedByLock = true; });
      KQuiz.on("addonClosed", ()=>{ if(getMode()==="lockAll") pausedByLock = false; });
    }
  }catch{}

  function scoringLocked(){
    const mode = getMode();
    if(mode==="never") return false;
    if(mode==="lockAll"){
      if(pausedByLock) return true;
      if(window.KQ_SCORING_LOCK) return true;
    }
    if(inScoreWindow) return true;
    if((window.KQ_SCORING_LOCK||"") === "score") return true;
    return false;
  }

  // -------- Caps per question --------
  const perQCaps = new Map();
  function resetCaps(){ perQCaps.clear(); }
  function applyCap(name, pts){
    const cap = getCap();
    if(cap<=0) return pts;
    const key = norm(name);
    const used = perQCaps.get(key)||0;
    if(used >= cap) return 0;
    const room = cap - used;
    const grant = Math.min(room, pts);
    perQCaps.set(key, used + grant);
    return grant;
  }

  // -------- Players & scoring --------
  function findPlayerIdByName(name){
    const players = KQuiz.state.players || {};
    const key = norm(name);
    return Object.keys(players).find(id => norm(players[id]?.name)===key) || null;
  }
  function addPoints(name, pts){
    const id = findPlayerIdByName(name);
    if(!id) return false;
    const players = KQuiz.state.players;
    const before = Number(players[id].score||0);
    const after  = before + pts;
    players[id].score = after;
    try{ KQuiz.emit && KQuiz.emit("scoresChanged",{ id, before, after, player:players[id], correct:true }); }catch{}
    banner && banner(`+${pts} taškų`, `${name} dalinosi transliacija`);
    return true;
  }

  // -------- Parse share message --------
  function parseShare(msg){
    if(!msg || typeof msg!=="object") return null;
    const kind = String(msg.type||"").toLowerCase();
    const baseName  = msg.displayName || msg.user?.nickname || msg.nickname || msg.username;
    const baseId    = msg.id || msg.msgId || msg.messageId;
    if(kind==="share"){ return { name: baseName, count: 1, id: baseId }; }
    // accept other notations too
    if(kind==="social"){
      const ev = String(msg.event||msg.displayType||msg.action||"").toLowerCase();
      if(ev.includes("share")) return { name: baseName, count: Number(msg.count||1)||1, id: baseId };
    }
    if(kind==="event" && String(msg.subType||"").toLowerCase()==="share"){
      return { name: baseName, count: Number(msg.count||1)||1, id: baseId };
    }
    return null;
  }

  // -------- Independent WS listener --------
  let ws=null, retry=0, stop=false;
  const seen = new Set();
  function seenOnce(id){
    if(!id) return true;
    if(seen.has(id)) return false;
    seen.add(id);
    if(seen.size>4000){
      const it = seen.values(); for(let i=0;i<400;i++){ const v=it.next(); if(v.done) break; seen.delete(v.value); }
    }
    return true;
  }

  function connect(){
    if(stop) return;
    try{
      const proto = location.protocol==="https:" ? "wss" : "ws";
      const url = `${proto}://${location.host}/stream`;
      ws = new WebSocket(url);
      ws.addEventListener("open", ()=>{ retry=0; });
      ws.addEventListener("message", ev=>{
        try{
          const s = typeof ev.data==="string" ? ev.data : "";
          if(!s) return;
          const m = JSON.parse(s);
          const p = parseShare(m);
          if(!p || !p.name) return;
          if(!seenOnce(p.id)) return;
          if(scoringLocked()) return;
          const rawPts = Math.max(0, Math.min(100, 2 * Number(p.count||1)));
          const pts = applyCap(p.name, rawPts);
          if(pts>0) addPoints(p.name, pts);
        }catch{}
      });
      ws.addEventListener("close", ()=>{
        ws=null;
        if(stop) return;
        const backoff = Math.min(5000, 300 + retry*500);
        retry++;
        setTimeout(connect, backoff);
      });
      ws.addEventListener("error", ()=>{ try{ ws && ws.close(); }catch{} });
    }catch{
      setTimeout(connect, 1000);
    }
  }

  KQuiz.registerAddon({
    id: "share-points",
    name: "Dalijimų taškai (+2 už dalijimą)",
    description: "Klausosi /stream savarankiškai. +2 už share, pauzė tik rezultatų lange (konfigūruojama).",
    defaultEnabled: true,
    enable(){ stop=false; resetCaps(); connect(); },
    disable(){ stop=true; try{ ws && ws.close(); }catch{} }
  });
})();