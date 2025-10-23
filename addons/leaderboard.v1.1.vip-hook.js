/* KQuiz addon: Leaderboard v1.1 — top-3 scaling */
(function(){
  function factory(){
    let mounted=false, scoresHandler=null;
    let overlay=null, listEl=null, floatBtn=null;

    const $=(q,r=document)=>r.querySelector(q);
    const el=(t,a={},...cs)=>{const n=document.createElement(t);for(const[k,v]of Object.entries(a)){k==='class'?n.className=v:n.setAttribute(k,v)}cs.forEach(c=>n.appendChild(typeof c==='string'?document.createTextNode(c):c));return n};

    function mountUI(){
      if(mounted) return;
      overlay=$("#lbModal"); listEl=$("#lbList"); floatBtn=$(".float-lb");
      if(!overlay){
        overlay=el('div',{id:'lbModal',class:'overlay'});
        const card=el('div',{class:'card'},
          el('div',{style:'text-align:center;font-weight:1000;font-size:22px;margin-bottom:6px'},'Lyderių lentelė'),
          (listEl=el('div',{class:'lbList',id:'lbList'})),
          el('div',{style:'text-align:center;margin-top:12px'}, el('button',{class:'btn',id:'lbClose'},'Uždaryti'))
        );
        overlay.appendChild(card); document.body.appendChild(overlay);
      }
      if(!floatBtn){ floatBtn=el('button',{class:'float-lb',id:'lbOpen'},'Lyderių lentelė'); document.body.appendChild(floatBtn); }
      (document.getElementById('lbClose')||overlay.querySelector('button.btn')).onclick=closeLeaderboard;
      (document.getElementById('lbOpen')||floatBtn).onclick=openLeaderboard;
      window.openLeaderboard=openLeaderboard; window.closeLeaderboard=closeLeaderboard;
      mounted=true;
    }

    function render(K){
      if(!listEl) return;
      listEl.innerHTML='';
      const arr=Object.entries(K.state.players).map(([id,p])=>({id,name:p.name||id,score:p.score||0,avatar:p.avatar||''}));
      arr.sort((a,b)=> b.score-a.score || a.name.localeCompare(b.name));

      if(!arr.length){
        listEl.appendChild(el('div',{class:'row'}, el('div',{},'Nėra žaidėjų'), el('div',{},'0'))); return;
      }

      arr.forEach((p,i)=>{
        const factor = i===0?1.6 : i===1?1.4 : i===2?1.2 : 1.0;
        const avSize = Math.round(28*factor);
        const nameSize = Math.round(16*factor);

        const img = p.avatar
          ? el('img',{
              class:'av kq-av kquiz-avatar',
              src:(window.KQuiz&&window.KQuiz.util&&window.KQuiz.util.proxyURL)?window.KQuiz.util.proxyURL(p.avatar):p.avatar,
              alt:p.name||'',
              referrerpolicy:'no-referrer',
              style:`width:${avSize}px;height:${avSize}px`})
          : el('span',{},'');
        if (img) {
          try {
            img.dataset.uid = String(p.id || '');
            img.dataset.name = p.name || '';
          } catch {}
          img.setAttribute('data-uid', String(p.id || ''));
          img.setAttribute('data-name', p.name || '');
          img.title = p.name || '';
        }

        const nameEl = el('div',{style:`font-weight:900;font-size:${nameSize}px;transform-origin:left center`}, `${i+1}. ${p.name}`);

        const left = el('div',{class:'rowL'}, img, nameEl);
        listEl.appendChild(el('div',{class:'row'}, left, el('div',{}, String(p.score))));
      });

      try { window.KQ_VIP?.scan?.(); } catch {}
    }

    function openLeaderboard(){ if(overlay){ overlay.style.display='flex'; render(window.KQuiz); } }
    function closeLeaderboard(){ if(overlay) overlay.style.display='none'; }

    function enable(K){
      mountUI(); render(K);
      scoresHandler=()=>{ if(overlay && overlay.style.display==='flex') render(K); };
      K.on('scoresChanged', scoresHandler);
    }
    function disable(){
      try{ if(scoresHandler && window.KQuiz) window.KQuiz.off('scoresChanged', scoresHandler); }catch{}
      scoresHandler=null; if(overlay) overlay.style.display='none';
      try{ delete window.openLeaderboard; delete window.closeLeaderboard; }catch{}
      mounted=false;
    }

    return { id:'leaderboard', name:'Leaderboard', description:'Lyderių lentelė su TOP-3 padidinimu.', defaultEnabled:true, enable, disable };
  }
  function register(){ if(!window.KQuiz||!window.KQuiz.registerAddon) return setTimeout(register,100); window.KQuiz.registerAddon(factory()); }
  register();
})();
// === header image inject (think.png in SAME folder as this addon) ===
(function(){
  const SCR = (document.currentScript || [...document.querySelectorAll('script[src]')].pop())?.src || location.href;
  const assetInSameDir = (name)=>{
    try { if (window.KQ_ASSETS?.image) return window.KQ_ASSETS.image(name); } catch {}
    try{
      const u=new URL(SCR,location.href); u.pathname=u.pathname.replace(/[^/]+$/,'');
      const resolved = new URL(name,u).href;
      return resolved.includes("/addons/") ? resolved.replace("/addons/","/assets/images/") : resolved;
    }catch{}
    return name;
  };
  function swapHeader(){
    const modal = document.getElementById('lbModal');
    if(!modal) return;
    const card = modal.querySelector('.card'); if(!card) return;
    const hdr  = card.firstElementChild; if(!hdr) return;
    if(hdr.querySelector('img')) return; // already swapped
    hdr.innerHTML = '';
    hdr.style.textAlign = 'center'; hdr.style.marginBottom = '6px';
    const img = document.createElement('img');
    img.src = assetInSameDir('think.png');
    img.alt = ''; img.style.maxWidth = '220px'; img.style.width = '40vw'; img.style.height = 'auto'; img.style.display = 'block'; img.style.margin = '0 auto';
    hdr.appendChild(img);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', swapHeader);
  else swapHeader();
})();
