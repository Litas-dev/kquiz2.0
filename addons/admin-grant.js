/* KQuiz Addon: Admin Grant — v2.0
   Admin can grant all three currencies used by Duel addon via chat:
     • !glasses<rank>[x<count>]  → target credits for !top
     • !duel<rank>[x<count>]     → duel credits (same as ROSE)
     • !shield<rank>[x<count>]   → shield units (10 min each, same as ROSA)
   Extras: !setadmin, !whoami, !ping. On-screen toast logger. Dual-bus emit.
*/
(function () {
  function factory() {
    // storage
    function load(){ try{ return JSON.parse(localStorage.getItem('kq_admin_grant')||'{}'); }catch{ return {}; } }
    function save(){ try{ localStorage.setItem('kq_admin_grant', JSON.stringify(CFG)); }catch{} }
    let CFG = load();
    if(!CFG.adminId){ CFG.adminId = ""; save(); }

    function duelCfg(){ try{ return JSON.parse(localStorage.getItem('kq_duel_cfg')||'{}'); }catch{ return {}; } }

    let K=null; const off=[];

    const lc=(v)=>v==null?'':String(v).toLowerCase().trim();

    // ---------- UI TOAST LOGGER ----------
    let styleEl=null, toastBox=null;
    function ensureUI(){
      if(!styleEl){
        styleEl=document.createElement('style');
        styleEl.textContent=`
.kq-toastbox{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9999;
  display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}
.kq-toast{max-width:86vw;background:rgba(15,23,42,.92);color:#eaf0ff;border:1px solid rgba(255,255,255,.14);
  padding:10px 14px;border-radius:12px;font:800 13px system-ui;box-shadow:0 8px 20px rgba(0,0,0,.45);opacity:0;
  transform:translateY(8px);animation:kqIn .2s ease-out forwards}
@keyframes kqIn{to{opacity:1;transform:translateY(0)}}
.kq-toast.hide{animation:kqOut .25s ease-in forwards}
@keyframes kqOut{to{opacity:0;transform:translateY(8px)}}
`;
        document.head.appendChild(styleEl);
      }
      if(!toastBox){
        toastBox=document.createElement('div');
        toastBox.className='kq-toastbox';
        document.body.appendChild(toastBox);
      }
    }
    function toast(txt, ms){
      try{
        ensureUI();
        const el=document.createElement('div');
        el.className='kq-toast';
        el.textContent=String(txt||'');
        toastBox.appendChild(el);
        const ttl = Math.max(1200, ms||2000);
        setTimeout(()=>{ el.classList.add('hide'); setTimeout(()=>{ try{el.remove();}catch{} }, 260); }, ttl);
      }catch(e){ console.log('[admin-grant toast]', txt); }
    }

    // ---------- IDs ----------
    function canonIdFrom(msg){
      const u = msg?.user || msg || {};
      const cand = [
        u.secUid, msg?.secUid,
        u.uniqueId, msg?.uniqueId, u.username, msg?.username,
        u.nickName, u.nickname,
        u.userId, msg?.userId, u.id, msg?.id
      ];
      for(const c of cand){ if(c){ return lc(c); } }
      return "";
    }
    function isAdmin(msg){
      const me = canonIdFrom(msg);
      return !!(me && CFG.adminId && lc(me)===lc(CFG.adminId));
    }

    // ---------- Leaderboard ----------
    function top10Entries(){
      const entries = Object.entries(K.state.players||{});
      entries.sort((a,b)=>(b[1].score||0)-(a[1].score||0));
      return entries.slice(0,10).map(([id,rec],i)=>({ idx:i+1, id:lc(id), name:rec.name||id, score:rec.score||0 }));
    }

    // ---------- Synthetic Gift ----------
    function syntheticGift(forCanonId, forName, count, type){
      const dcfg = duelCfg();
      // map types to gift names configured in duel
      const giftName = (type==='glasses')
        ? ((dcfg?.targetGiftNames && dcfg.targetGiftNames[0]) || "sunglasses")
        : (type==='duel')
          ? ((dcfg?.creditGiftNames && dcfg.creditGiftNames[0]) || "rose")
          : ((dcfg?.shieldGiftNames && dcfg.shieldGiftNames[0]) || "rosa");
      const gift = {
        event: "gift",
        gift: {
          id: "999999",
          giftId: "999999",
          giftName: giftName,
          name: giftName,
          count: count || 1,
          repeatCount: count || 1,
          diamondCount: 0,
          image: { url: "", url_list: [] },
          icon:  { url: "", url_list: [] },
        },
        user: {
          uniqueId: forCanonId,
          nickname: forName || forCanonId,
          profilePictureUrl: ""
        }
      };
      try { K.emit?.("gift", gift); } catch(e){ console.warn("emit gift failed", e); }
      try { K.emit?.("wsMessage", { type:"gift", data: gift }); } catch(e){ console.warn("emit wsMessage failed", e); }
    }

    // ---------- Commands ----------
    function parseGrant(cmd, text){
      const m = text.match(new RegExp("^!"+cmd+"\\s*(\\d{1,2})(?:\\s*[xX]\\s*(\\d{1,3}))?$","i"));
      if(!m) return null;
      return { rank: parseInt(m[1],10), count: Math.max(1, parseInt(m[2]||"1",10)) };
    }

    function handleCommand(msg){
      const text = String(msg?.text||"").trim();
      if(!text.startsWith('!')) return;

      if(/^!ping\b/i.test(text)){ toast('pong'); return; }
      if(/^!whoami\b/i.test(text)){ toast('whoami → '+(canonIdFrom(msg)||'(unknown)')); return; }
      const set = text.match(/^!setadmin(?:\s+(.{2,64}))?$/i);
      if(set){
        const explicit = set[1] && lc(set[1]);
        const me = canonIdFrom(msg);
        CFG.adminId = explicit || me || "";
        save();
        toast('Admin set → '+(CFG.adminId||'(empty)'));
        return;
      }

      // grant handlers
      const grants = [
        { cmd:'glasses', type:'glasses', label:'sunglasses credits' },
        { cmd:'duel',    type:'duel',    label:'duel credits' },
        { cmd:'shield',  type:'shield',  label:'shield units' },
      ];
      for(const g of grants){
        if(new RegExp("^!"+g.cmd,"i").test(text)){
          if(!isAdmin(msg)){ toast('Not admin'); return; }
          const p = parseGrant(g.cmd, text);
          if(!p){ toast('Syntax: !'+g.cmd+'<rank> or !'+g.cmd+'<rank>x<count>'); return; }
          const list = top10Entries();
          const entry = list.find(e=>e.idx===p.rank);
          if(!entry){ toast('Rank out of range. Use 1–10.'); return; }
          syntheticGift(entry.id, entry.name, p.count, g.type);
          toast(`Granted ${p.count}× ${g.label} → ${entry.name} (#${p.rank})`);
          return;
        }
      }
    }

    // ---------- Wiring ----------
    function enable(ctx){
      K=ctx;
      toast('admin-grant online v2.0', 2200);
      const hChat=(m)=>handleCommand(m);
      const hWs=(f)=>{ if(f?.type==='chat') handleCommand(f); };
      K.on?.('chat', hChat);
      K.on?.('wsMessage', hWs);
      off.push(()=>{ try{K.off?.('chat',hChat);}catch{} });
      off.push(()=>{ try{K.off?.('wsMessage',hWs);}catch{} });
    }
    function disable(){
      off.forEach(fn=>fn()); off.length=0;
      if(styleEl){ try{styleEl.remove();}catch{} styleEl=null; }
      if(toastBox){ try{toastBox.remove();}catch{} toastBox=null; }
    }
    return { id:'adminGrant', name:'Admin: grant duel/target/shield', description:'!setadmin. !glasses/!duel/!shield <rank>[x<count>].', defaultEnabled:true, enable, disable };
  }
  function register(){ if(!window.KQuiz?.registerAddon) return setTimeout(register,120); window.KQuiz.registerAddon(factory()); }
  register();
})();