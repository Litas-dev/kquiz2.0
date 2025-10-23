/* KQuiz Addon: Top5 Background board — VIP/SUB aware */
(function(){
  function factory(){
    let K=null;
    let styleEl=null, root=null, listEl=null;
    let overlayObserver=null;
    let off=[];
    let lastSig="";

    const ensureStyle = ()=>{
      if(styleEl) return;
      styleEl=document.createElement('style');
      styleEl.textContent=`
      .kq-top5bg{position:relative;display:flex;flex-direction:column;gap:8px;padding:12px 16px;border-radius:16px;backdrop-filter:blur(8px);background:rgba(8,12,24,0.78);border:1px solid rgba(255,255,255,0.14);color:#f1f4ff;font-family:'Inter',system-ui,sans-serif;max-width:320px;}
      .kq-top5bg-list{display:flex;flex-direction:column;gap:8px;}
      .kq-top5bg-row{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:12px;background:rgba(255,255,255,0.04);} 
      .kq-top5bg-row[data-rank="1"]{background:linear-gradient(90deg,rgba(255,215,0,0.18),rgba(255,255,255,0.06));}
      .kq-top5bg-row[data-rank="2"]{background:linear-gradient(90deg,rgba(206,212,218,0.2),rgba(255,255,255,0.06));}
      .kq-top5bg-row[data-rank="3"]{background:linear-gradient(90deg,rgba(245,159,0,0.2),rgba(255,255,255,0.06));}
      .kq-top5bg-avatar{position:relative;display:flex;align-items:center;justify-content:center;}
      .kq-top5bg-avatar .kq-top5bg-initial{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.75);border:1px solid rgba(255,255,255,0.18);}
      .kq-top5bg-avatar img{width:44px;height:44px;border-radius:50%;object-fit:cover;box-shadow:0 6px 12px rgba(0,0,0,0.32);} 
      .kq-top5bg-name{flex:1;display:flex;align-items:center;gap:6px;font-weight:700;font-size:16px;text-shadow:0 2px 4px rgba(0,0,0,0.3);} 
      .kq-top5bg-score{font-weight:800;font-size:18px;min-width:48px;text-align:right;color:#ffd43b;}
      .kq-top5bg-header{font-weight:900;font-size:18px;margin-bottom:2px;display:flex;align-items:center;justify-content:space-between;}
      .kq-top5bg-header span{font-size:12px;font-weight:500;color:rgba(255,255,255,0.62);} 
      `;
      document.head.appendChild(styleEl);
    };

    const ensureRoot = ()=>{
      if(!root || !root.isConnected){
        root=document.getElementById('top5bg');
        if(!root){
          root=document.createElement('div');
          root.id='top5bg';
          document.body.appendChild(root);
        }
      }
      if(!root) return;
      root.classList.add('kq-top5bg');
      if(!root.style.display) root.style.display='none';
      try{ root.dataset.kqTop5bg='1'; }catch{}
      if(!root.querySelector('.kq-top5bg-header')){
        const hdr=document.createElement('div');
        hdr.className='kq-top5bg-header';
        hdr.innerHTML='<div>Top 5</div><span>Taškai</span>';
        root.appendChild(hdr);
      }
      if(!listEl || !listEl.isConnected || listEl.parentNode!==root){
        listEl=document.createElement('div');
        listEl.className='kq-top5bg-list';
        root.appendChild(listEl);
      }
    };

    const isOverlayVisible = ()=>{
      const overlay=document.getElementById('overlay');
      if(!overlay) return false;
      const mode = (overlay.dataset && overlay.dataset.kqView) || overlay.getAttribute?.('data-kq-view') || '';
      if(mode !== 'results') return false;
      const inline=(overlay.style && typeof overlay.style.display==='string') ? overlay.style.display.trim() : '';
      if(inline){ return inline !== 'none'; }
      try{ return window.getComputedStyle(overlay).display !== 'none'; }catch{}
      return false;
    };

    const syncVisibility = ()=>{
      ensureRoot();
      if(!root) return;
      root.style.display = isOverlayVisible() ? 'block' : 'none';
    };

    function sortTop(){
      const players = Object.entries(K?.state?.players||{}).map(([id,p])=>({
        id,
        name:p?.name||id,
        score:Number(p?.score)||0,
        avatar:p?.avatar||p?.picture||''
      }));
      players.sort((a,b)=> b.score-a.score || a.name.localeCompare(b.name));
      return players.slice(0,5);
    }

    const tagNode = (node, player)=>{
      if(!node || !player) return;
      const uid = String(player.id||'');
      const name = player.name||'';
      try{ if(node.dataset){ node.dataset.uid=uid; node.dataset.name=name; } }catch{}
      node.setAttribute('data-uid', uid);
      node.setAttribute('data-name', name);
      if(name && !node.getAttribute('aria-label')) node.setAttribute('aria-label', name);
      if(name && !node.title) node.title=name;
    };

    const render = ()=>{
      if(!K) return;
      ensureStyle();
      if(!root || !root.isConnected){ root=null; listEl=null; }
      ensureRoot();
      const top = sortTop();
      const sig = JSON.stringify(top.map(p=>[p.id,p.score,p.avatar,p.name]));
      if(sig===lastSig){
        syncVisibility();
        return;
      }
      lastSig=sig;
      if(!listEl) ensureRoot();
      listEl.innerHTML='';
      const helpers = window.KQ_VIP || null;
      if(top.length===0){
        const empty=document.createElement('div');
        empty.className='kq-top5bg-row';
        empty.textContent='Nėra žaidėjų';
        listEl.appendChild(empty);
        return;
      }
      top.forEach((p,idx)=>{
        const rank=idx+1;
        const row=document.createElement('div');
        row.className='kq-top5bg-row';
        row.dataset.rank=String(rank);

        const avatarWrap=document.createElement('div');
        avatarWrap.className='kq-top5bg-avatar';
        let avatarNode;
        if(p.avatar){
          const proxied = (window.KQuiz?.util?.proxyURL) ? window.KQuiz.util.proxyURL(p.avatar) : p.avatar;
          avatarNode=document.createElement('img');
          avatarNode.src=proxied;
          avatarNode.alt=`#${rank} ${p.name}`;
          avatarNode.referrerPolicy='no-referrer';
        }else{
          avatarNode=document.createElement('div');
          avatarNode.className='kq-top5bg-initial';
          avatarNode.textContent=(p.name?.charAt(0)||'#').toUpperCase();
        }
        avatarNode.classList.add('kq-av');
        avatarNode.classList.add('avatar');
        avatarNode.classList.add('kquiz-avatar');
        tagNode(avatarNode, p);
        avatarWrap.appendChild(avatarNode);

        const nameEl=document.createElement('div');
        nameEl.className='kq-top5bg-name';
        nameEl.textContent=`${rank}. ${p.name}`;
        try{ helpers?.decorateLabel?.(nameEl, { uid:p.id, id:p.id, name:p.name }); }catch{}

        const scoreEl=document.createElement('div');
        scoreEl.className='kq-top5bg-score';
        scoreEl.textContent=String(p.score);

        row.appendChild(avatarWrap);
        row.appendChild(nameEl);
        row.appendChild(scoreEl);
        listEl.appendChild(row);
      });
      try{
        queueMicrotask(()=>{ try{ window.KQ_VIP?.scan?.(); }catch{} });
      }catch{
        try{ window.KQ_VIP?.scan?.(); }catch{}
      }
      syncVisibility();
    };

    const handleScores = ()=>{ lastSig=""; render(); };
    const handleQuestionStart = ()=>{
      if(root) root.style.display='none';
      syncVisibility();
    };
    const handleQuestionEnd = ()=>{ handleScores(); syncVisibility(); };

    const enable = (ctx)=>{
      K=ctx;
      ensureStyle();
      ensureRoot();
      render();
      syncVisibility();
      const handlers=[
        ['scoresChanged', handleScores],
        ['leaderboardRefresh', handleScores],
        ['wsMessage', handleScores],
        ['gameStart', handleScores],
        ['questionStart', handleQuestionStart],
        ['questionEnd', handleQuestionEnd]
      ];
      handlers.forEach(([evt,fn])=>{ try{ K.on?.(evt, fn); off.push(()=>{ try{ K.off?.(evt, fn); }catch{} }); }catch{} });
      const vipHandler=()=>{ handleScores(); };
      try{
        window.addEventListener('kqvip:ready', vipHandler);
        window.addEventListener('kqvip:change', vipHandler);
        off.push(()=>{ try{ window.removeEventListener('kqvip:ready', vipHandler); }catch{} });
        off.push(()=>{ try{ window.removeEventListener('kqvip:change', vipHandler); }catch{} });
      }catch{}
      try{
        const overlay=document.getElementById('overlay');
        if(overlay){
          overlayObserver = new MutationObserver(syncVisibility);
          overlayObserver.observe(overlay, { attributes:true, attributeFilter:['style','class','data-kq-view'] });
          off.push(()=>{ try{ overlayObserver && overlayObserver.disconnect(); }catch{} overlayObserver=null; });
        }
      }catch{}
    };

    const disable = ()=>{
      off.forEach(fn=>{ try{ fn(); }catch{} });
      off=[];
      K=null;
      lastSig="";
      if(listEl){ try{ listEl.innerHTML=''; }catch{} }
      listEl=null;
      if(root){ try{ root.classList.remove('kq-top5bg'); }catch{} }
      if(overlayObserver){ try{ overlayObserver.disconnect(); }catch{} }
      overlayObserver=null;
    };

    return { id:'top5bg', name:'Top5 BG lentelė', description:'Rodo Top-5 foninėje lentoje su VIP/SUB ženklais.', defaultEnabled:true, enable, disable };
  }
  function register(){ if(!window.KQuiz?.registerAddon) return setTimeout(register,100); window.KQuiz.registerAddon(factory()); }
  register();
})();
