/* KQuiz Addon: Top5 Ribbon — v1.4 (place under question)
   Shows Top-5 directly UNDER the main question block on all devices.
   Removes right-side ribbon. Keeps mobile strip style.
*/
(function () {
  function factory() {
    let K=null, off=[];
    let styleEl=null, strip=null, lastSig="";

    function sortTop(players){
      const arr = Object.entries(players||{}).map(([id,p])=>({
        rawId:String(id),
        id:String(id).toLowerCase(),
        name:p.name||id,
        avatar:p.avatar||p.picture||"",
        score:p.score||0
      }));
      arr.sort((a,b)=> (b.score)-(a.score));
      return arr.slice(0,5);
    }

    function ensureUI(){
      if(!styleEl){
        styleEl=document.createElement('style');
        styleEl.textContent=`
.kq-top3-strip{
  display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap;
  padding:8px 10px;margin:8px 0 6px 0;border-radius:12px;
  background:rgba(12,18,36,.82);border:1px solid rgba(255,255,255,.12);
  justify-content:center;z-index:30
}
.kq-top3-chip{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;min-width:68px}
.kq-top3-avatar{position:relative;display:inline-flex}
.kq-top3-avatar img{
  width:44px;height:44px;border-radius:50%;
  object-fit:cover;box-shadow:0 6px 12px rgba(0,0,0,.35);
  transition:transform .2s ease, opacity .2s ease
}
.kq-top3-chip[data-rank="1"] .kq-top3-avatar img{border:3px solid #ffd43b; box-shadow:0 0 0 3px rgba(255,212,59,.25), 0 6px 12px rgba(0,0,0,.35)}
.kq-top3-chip[data-rank="2"] .kq-top3-avatar img{border:3px solid #ced4da; box-shadow:0 0 0 3px rgba(206,212,218,.25), 0 6px 12px rgba(0,0,0,.35)}
.kq-top3-chip[data-rank="3"] .kq-top3-avatar img{border:3px solid #f59f00; box-shadow:0 0 0 3px rgba(245,159,0,.25), 0 6px 12px rgba(0,0,0,.35)}
.kq-top3-chip[data-rank="4"] .kq-top3-avatar img, .kq-top3-chip[data-rank="5"] .kq-top3-avatar img{border:3px solid rgba(255,255,255,.22)}
.kq-top3-chip .rank{
  position:absolute;right:-6px;top:-6px;width:20px;height:20px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;font:900 11px system-ui;
  background:#ffd43b;color:#222;border:2px solid #1d2233
}
.kq-top3-chip[data-rank="2"] .rank{background:#ced4da}
.kq-top3-chip[data-rank="3"] .rank{background:#f59f00}
.kq-top3-chip[data-rank="4"] .rank, .kq-top3-chip[data-rank="5"] .rank{background:#8892a6;color:#10131a}
.kq-top3-name{
  font:700 12px/1.2 "Inter",system-ui,sans-serif;
  color:#f1f4ff;
  text-shadow:0 2px 4px rgba(0,0,0,.45);
  display:flex;
  align-items:center;
  gap:6px;
  text-align:center;
  justify-content:center;
}
.kq-top3-name .kq-badge{margin-left:4px}
.kq-slide-x{animation:kqSlideX .35s ease}
@keyframes kqSlideX{ from{ transform:translateX(12px); opacity:0 } to{ transform:translateX(0); opacity:1 } }
`;
        document.head.appendChild(styleEl);
      }
      if(!strip){
        strip=document.createElement('div');
        strip.className='kq-top3-strip';
        // Anchor strictly under the main question block
        const anchor = document.querySelector('#question, .question, .quiz-question');
        if(anchor && anchor.parentElement){
          anchor.parentElement.insertBefore(strip, anchor.nextElementSibling);
        }else{
          // fallback near timer
          const anchor2 = document.querySelector('.timer,.countdown,.ticker,#timer,#countdown,#ticker') || document.body;
          anchor2.parentElement ? anchor2.parentElement.insertBefore(strip, anchor2.nextSibling) : document.body.appendChild(strip);
        }
      }
    }

    function render(){
      ensureUI();
      const top = sortTop(K.state.players||{});
      const sig = JSON.stringify(top.map(p=>[(p.rawId||p.id),p.score,p.avatar,p.name]));
      if(sig===lastSig) return;
      lastSig=sig;
      strip.innerHTML='';
      const helpers = window.KQ_VIP || null;
      top.forEach((p,i)=>{
        const rank=i+1;
        const factor = i===0?1.6 : i===1?1.4 : i===2?1.2 : 1.0;
        const avSize = Math.round(28*factor);
        const nameSize = Math.round(16*factor);
        const raw = p.avatar||'';
        const src = (K.util && K.util.proxyURL) ? K.util.proxyURL(raw) : raw;
        const chip=document.createElement('div');
        chip.className='kq-top3-chip kq-slide-x';
        chip.dataset.rank=String(rank);
        chip.title=`#${rank} ${p.name} (${p.score})`;

        const avatarWrap=document.createElement('div');
        avatarWrap.className='kq-top3-avatar';

        let avatarNode;
        if(src){
          avatarNode=document.createElement('img');
          avatarNode.src=src;
          avatarNode.style.width=`${avSize}px`;
          avatarNode.style.height=`${avSize}px`;
        }else{
          avatarNode=document.createElement('div');
          avatarNode.style.cssText=`width:${avSize}px;height:${avSize}px;border-radius:50%;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);display:inline-flex;align-items:center;justify-content:center;color:rgba(255,255,255,.65);font-weight:700;`;
          avatarNode.textContent=(name.charAt(0)||'#').toUpperCase();
        }
        avatarNode.classList.add('kq-av');
        avatarNode.classList.add('avatar');
        avatarNode.classList.add('kquiz-avatar');
        if(avatarNode.tagName==='IMG') avatarNode.alt=`#${rank} ${p.name}`;
        const uid = p.rawId || p.id || '';
        const name = p.name || uid || '';
        try{ if(avatarNode.dataset){ avatarNode.dataset.uid = uid; avatarNode.dataset.name = name; } }catch{}
        avatarNode.setAttribute('data-uid', uid);
        avatarNode.setAttribute('data-name', name);
        if(name){
          avatarNode.setAttribute('aria-label', name);
        }
        if(!avatarNode.getAttribute('title')) avatarNode.setAttribute('title', name);

        const rankEl=document.createElement('div');
        rankEl.className='rank';
        rankEl.textContent=String(rank);

        avatarWrap.appendChild(avatarNode);
        avatarWrap.appendChild(rankEl);

        const label=document.createElement('div');
        label.className='kq-top3-name';
        label.style.fontSize=`${nameSize}px`;
        label.textContent=name;
        try{ helpers?.decorateLabel?.(label, { uid, id:uid, name }); }catch{}

        chip.appendChild(avatarWrap);
        chip.appendChild(label);
        strip.appendChild(chip);
      });
      try{
        queueMicrotask(()=>{ try{ window.KQ_VIP?.scan?.(); }catch{} });
      }catch{
        try{ window.KQ_VIP?.scan?.(); }catch{}
      }
    }

    function enable(ctx){
      K=ctx; ensureUI(); render();
      const onAny=()=>render();
      K.on?.('leaderboardRefresh', onAny);
      K.on?.('gameStart', onAny);
      K.on?.('wsMessage', onAny);
      window.addEventListener('resize', onAny);
      const vipHandler=()=>{ lastSig=""; render(); };
      try{
        window.addEventListener('kqvip:ready', vipHandler);
        window.addEventListener('kqvip:change', vipHandler);
        off.push(()=>{ try{ window.removeEventListener('kqvip:ready', vipHandler); }catch{} });
        off.push(()=>{ try{ window.removeEventListener('kqvip:change', vipHandler); }catch{} });
      }catch{}
      off.push(()=>{ try{K.off?.('leaderboardRefresh', onAny);}catch{} });
      off.push(()=>{ try{K.off?.('gameStart', onAny);}catch{} });
      off.push(()=>{ try{K.off?.('wsMessage', onAny);}catch{} });
      off.push(()=>{ window.removeEventListener('resize', onAny); });
    }
    function disable(){
      off.forEach(fn=>fn()); off.length=0;
      if(strip){ try{strip.remove();}catch{} strip=null; }
      if(styleEl){ try{styleEl.remove();}catch{} styleEl=null; }
    }
    return { id:'top5Ribbon', name:'Top-5 po klausimu', description:'Rodo Top-5 tiesiai po klausimo bloke', defaultEnabled:true, enable, disable };
  }
  function register(){ if(!window.KQuiz?.registerAddon) return setTimeout(register,120); window.KQuiz.registerAddon(factory()); }
  register();
})();
