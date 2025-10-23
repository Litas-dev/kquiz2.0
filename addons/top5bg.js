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
      .kq-top5bg{position:relative;display:flex;flex-direction:column;gap:10px;padding:10px 14px;border-radius:14px;background:rgba(8,12,24,0.82);border:1px solid rgba(255,255,255,0.12);color:#f1f4ff;font-family:'Inter',system-ui,sans-serif;width:100%;box-sizing:border-box;}
      .kq-top5bg-header{display:flex;align-items:center;justify-content:space-between;font-weight:800;font-size:16px;letter-spacing:0.02em;color:rgba(255,255,255,0.85);}
      .kq-top5bg-header span{font-size:12px;font-weight:500;color:rgba(255,255,255,0.54);}
      .kq-top5bg-list{display:flex;flex-direction:column;gap:6px;}
      .kq-top5bg-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;background:rgba(255,255,255,0.04);box-shadow:0 4px 12px rgba(0,0,0,0.18);position:relative;}
      .kq-top5bg-row[data-kq-tier="vip"] .kq-top5bg-avatar::after,
      .kq-top5bg-row[data-kq-tier="sub"] .kq-top5bg-avatar::after{content:"";position:absolute;inset:-2px;border-radius:999px;border:3px solid transparent;box-shadow:0 0 0 2px rgba(0,0,0,0.35);pointer-events:none;}
      .kq-top5bg-row[data-kq-tier="vip"] .kq-top5bg-avatar::after{border-color:rgba(255,215,0,0.95);box-shadow:0 0 12px rgba(255,215,0,0.35);}
      .kq-top5bg-row[data-kq-tier="sub"] .kq-top5bg-avatar::after{border-color:rgba(255,80,80,0.95);box-shadow:0 0 12px rgba(255,80,80,0.35);}
      .kq-top5bg-avatar{position:relative;display:flex;align-items:center;justify-content:center;width:48px;height:48px;}
      .kq-top5bg-avatar .kq-top5bg-initial{width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.75);border:2px solid rgba(255,255,255,0.16);box-shadow:0 4px 8px rgba(0,0,0,0.25);}
      .kq-top5bg-avatar img{width:48px;height:48px;border-radius:50%;object-fit:cover;box-shadow:0 4px 10px rgba(0,0,0,0.28);}
      .kq-top5bg-name{flex:1;display:flex;align-items:center;font-weight:700;font-size:16px;gap:6px;min-height:24px;}
      .kq-top5bg-rank{font-weight:800;font-size:18px;width:32px;text-align:center;color:rgba(255,255,255,0.7);}
      .kq-top5bg-score{font-weight:800;font-size:18px;min-width:60px;text-align:right;color:#ffd43b;}
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
      root.style.display='block';
      try{ root.dataset.kqTop5bg='1'; }catch{}
      if(root.parentNode!==board){
        if(answers && answers.parentNode===board){
          board.insertBefore(root, answers);
        }else{
          board.appendChild(root);
        }
      }
      if(!root.querySelector('.kq-top5bg-header')){
        const hdr=document.createElement('div');
        hdr.className='kq-top5bg-header';
        hdr.innerHTML='<div>TOP 5 žaidėjai</div><span>Taškai</span>';
        root.appendChild(hdr);
      }
      if(!listEl || !listEl.isConnected || listEl.parentNode!==root){
        listEl=document.createElement('div');
        listEl.className='kq-top5bg-list';
        root.appendChild(listEl);
      }
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

        const rankEl=document.createElement('div');
        rankEl.className='kq-top5bg-rank';
        rankEl.textContent=`${rank}.`;

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
        nameEl.textContent=p.name;
        if(helpers && typeof helpers.isSub==='function' && typeof helpers.isVip==='function'){
          const isSub=helpers.isSub(p.id, p.name);
          const isVip=!isSub && helpers.isVip(p.id, p.name);
          if(isSub || isVip){
            row.dataset.kqTier=isSub ? 'sub' : 'vip';
          }else{
            delete row.dataset.kqTier;
          }
        }

        const scoreEl=document.createElement('div');
        scoreEl.className='kq-top5bg-score';
        scoreEl.textContent=String(p.score);

        row.appendChild(rankEl);
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
