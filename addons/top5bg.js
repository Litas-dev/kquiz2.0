/* KQuiz Addon: Top5 Background board — VIP/SUB aware */
(function(){
  function factory(){
    let K=null;
    let styleEl=null, root=null, listEl=null;
    let off=[];
    let lastSig="";

    const ensureStyle = ()=>{
      if(styleEl) return;
      styleEl=document.createElement('style');
      styleEl.textContent=`
      .kq-top5bg{position:relative;display:flex;justify-content:center;align-items:center;gap:12px;margin:12px auto 6px;padding:0;color:inherit;font-family:inherit;width:100%;box-sizing:border-box;}
      .kq-top5bg-list{display:flex;flex-direction:row;gap:12px;margin:0;padding:0;list-style:none;justify-content:center;align-items:center;width:auto;}
      .kq-top5bg-item{position:relative;width:54px;height:54px;display:flex;align-items:center;justify-content:center;}
      .kq-top5bg-item::after{content:"";position:absolute;inset:-4px;border-radius:999px;border:3px solid transparent;box-shadow:none;pointer-events:none;}
      .kq-top5bg-item[data-kq-tier="vip"]::after{border-color:rgba(255,215,0,0.95);}
      .kq-top5bg-item[data-kq-tier="sub"]::after{border-color:rgba(255,80,80,0.95);}
      .kq-top5bg-avatar{width:48px;height:48px;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.08);}
      .kq-top5bg-avatar img{width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;}
      .kq-top5bg-avatar .kq-top5bg-initial{width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;background:rgba(255,255,255,0.16);color:inherit;}
      `;
      document.head.appendChild(styleEl);
    };

    const ensureRoot = ()=>{
      const board=document.querySelector('#game .board');
      if(!board) return;
      const answers=document.getElementById('ans');
      if(!root || !root.isConnected){
        root=document.getElementById('top5bg');
        if(!root){
          root=document.createElement('div');
          root.id='top5bg';
        }
      }
      if(!root) return;
      root.classList.add('kq-top5bg');
      root.style.display='none';
      try{ root.dataset.kqTop5bg='1'; }catch{}
      try{ root.querySelectorAll('.kq-top5bg-header').forEach(el=>el.remove()); }catch{}
      if(root.parentNode!==board){
        if(answers && answers.parentNode===board){
          board.insertBefore(root, answers);
        }else{
          board.appendChild(root);
        }
      }
      if(!listEl || !listEl.isConnected){
        listEl = root.querySelector('.kq-top5bg-list');
      }
      if(!listEl || listEl.parentNode!==root){
        listEl=document.createElement('div');
        listEl.className='kq-top5bg-list';
        root.appendChild(listEl);
      }
      try{
        root.querySelectorAll('.kq-top5bg-list').forEach(el=>{ if(el!==listEl) el.remove(); });
      }catch{}
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
        return;
      }
      lastSig=sig;
      if(!listEl) ensureRoot();
      if(!listEl) return;
      listEl.innerHTML='';
      const helpers = window.KQ_VIP || null;
      if(top.length===0){
        if(root) root.style.display='none';
        return;
      }
      if(root) root.style.display='flex';
      top.forEach((p,idx)=>{
        const rank=idx+1;
        const item=document.createElement('div');
        item.className='kq-top5bg-item';
        item.dataset.rank=String(rank);

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

        if(helpers && typeof helpers.isSub==='function' && typeof helpers.isVip==='function'){
          const isSub=helpers.isSub(p.id, p.name);
          const isVip=!isSub && helpers.isVip(p.id, p.name);
          if(isSub || isVip){
            item.dataset.kqTier=isSub ? 'sub' : 'vip';
          }else{
            item.removeAttribute('data-kq-tier');
          }
        }
        item.appendChild(avatarWrap);
        listEl.appendChild(item);
      });
      try{
        queueMicrotask(()=>{ try{ window.KQ_VIP?.scan?.(); }catch{} });
      }catch{
        try{ window.KQ_VIP?.scan?.(); }catch{}
      }
    };

    const handleScores = ()=>{ lastSig=""; render(); };
    const handleQuestionStart = ()=>{ handleScores(); };
    const handleQuestionEnd = ()=>{ handleScores(); };

    const enable = (ctx)=>{
      K=ctx;
      ensureStyle();
      ensureRoot();
      render();
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
    };

    const disable = ()=>{
      off.forEach(fn=>{ try{ fn(); }catch{} });
      off=[];
      K=null;
      lastSig="";
      if(listEl){ try{ listEl.innerHTML=''; }catch{} }
      listEl=null;
      if(root){ try{ root.classList.remove('kq-top5bg'); }catch{} }
    };

    return { id:'top5bg', name:'Top5 BG lentelė', description:'Rodo Top-5 foninėje lentoje su VIP/SUB ženklais.', defaultEnabled:true, enable, disable };
  }
  function register(){ if(!window.KQuiz?.registerAddon) return setTimeout(register,100); window.KQuiz.registerAddon(factory()); }
  register();
})();
