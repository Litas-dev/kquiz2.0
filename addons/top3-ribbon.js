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
  display:flex;align-items:center;gap:12px;
  padding:8px 10px;margin:8px 0 6px 0;border-radius:12px;
  background:rgba(12,18,36,.82);border:1px solid rgba(255,255,255,.12);
  justify-content:center;z-index:30
}
.kq-top3-chip{position:relative;display:flex;align-items:center;gap:8px}
.kq-top3-chip img{
  width:44px;height:44px;border-radius:50%;
  object-fit:cover;box-shadow:0 6px 12px rgba(0,0,0,.35);
  transition:transform .2s ease, opacity .2s ease
}
.kq-top3-chip[data-rank="1"] img{border:3px solid #ffd43b; box-shadow:0 0 0 3px rgba(255,212,59,.25), 0 6px 12px rgba(0,0,0,.35)}
.kq-top3-chip[data-rank="2"] img{border:3px solid #ced4da; box-shadow:0 0 0 3px rgba(206,212,218,.25), 0 6px 12px rgba(0,0,0,.35)}
.kq-top3-chip[data-rank="3"] img{border:3px solid #f59f00; box-shadow:0 0 0 3px rgba(245,159,0,.25), 0 6px 12px rgba(0,0,0,.35)}
.kq-top3-chip[data-rank="4"] img, .kq-top3-chip[data-rank="5"] img{border:3px solid rgba(255,255,255,.22)}
.kq-top3-chip .rank{
  position:absolute;right:-6px;top:-6px;width:20px;height:20px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;font:900 11px system-ui;
  background:#ffd43b;color:#222;border:2px solid #1d2233
}
.kq-top3-chip[data-rank="2"] .rank{background:#ced4da}
.kq-top3-chip[data-rank="3"] .rank{background:#f59f00}
.kq-top3-chip[data-rank="4"] .rank, .kq-top3-chip[data-rank="5"] .rank{background:#8892a6;color:#10131a}
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
      const sig = JSON.stringify(top.map(p=>[p.id,p.score,p.avatar]));
      if(sig===lastSig) return;
      lastSig=sig;
      strip.innerHTML = top.map((p,i)=>{
        const rank=i+1;
        const raw = p.avatar||'';
        const img = (K.util && K.util.proxyURL) ? K.util.proxyURL(raw) : raw;
        return `<div class="kq-top3-chip kq-slide-x" data-rank="${rank}" title="#${rank} ${p.name} (${p.score})">
          <img src="${img}" alt="#${rank} ${p.name}"><div class="rank">${rank}</div>
        </div>`;
      }).join('');
      try{ window.KQ_VIP?.scan?.(); }catch{}
    }

    function enable(ctx){
      K=ctx; ensureUI(); render();
      const onAny=()=>render();
      K.on?.('leaderboardRefresh', onAny);
      K.on?.('gameStart', onAny);
      K.on?.('wsMessage', onAny);
      window.addEventListener('resize', onAny);
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
