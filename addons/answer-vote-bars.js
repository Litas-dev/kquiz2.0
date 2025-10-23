/* KQuiz addon: Answer Vote Bars v1.5 (for .choice + .key)
   - Reads chat votes (A/B/C/D)
   - Fills each answer card background proportionally
   - Bars sit behind text; non-blocking; animated
   - Resets on new question; freezes on reveal
   - Selector matches your DOM: <div class="choice"><div class="key">A</div>Text…</div>
*/
(function () {
  // ---- fixed selector for your DOM ----
  const SELECTOR = '.choice';
  const GET_KEY = (node) => {
    const k = node.querySelector('.key');
    const s = (k && k.textContent) ? k.textContent : node.getAttribute('data-key') || node.textContent || '';
    const m = String(s).trim().toUpperCase().match(/^[ABCD]/);
    return m ? m[0] : null;
  };

  function factory() {
    let mounted=false, styleEl=null, mo=null, dbg=null;
    const counts = {A:0,B:0,C:0,D:0}; let total=0; let frozen=false;
    const FADE_MS=220;

    const $$=(q,r=document)=>Array.from(r.querySelectorAll(q));
    const el=(t,a={},...cs)=>{const n=document.createElement(t);for(const[k,v]of Object.entries(a||{})){k==='class'?n.className=v:n.setAttribute(k,v)}cs.forEach(c=>n.appendChild(typeof c==='string'?document.createTextNode(c):c));return n};

    function mountCSS(){
      if(mounted) return;
      styleEl=el('style',{},`
.kq-vb-holder{position:relative}
.kq-vb-wrap{position:absolute;inset:0;border-radius:inherit;overflow:hidden;z-index:0;pointer-events:none}
.kq-vb-fill{position:absolute;left:0;top:0;bottom:0;width:0%;
  background:linear-gradient(90deg,#1f3b6b,#2ee5a9);
  opacity:.18; transition:width ${FADE_MS}ms ease}
.kq-vb-meta{position:absolute;right:12px;bottom:10px;z-index:1;
  font:800 12px/1 system-ui,Segoe UI,Roboto,Arial,sans-serif;color:#9fb0c6}
.kq-vb-content{position:relative;z-index:2}
.kq-vb-badge{position:fixed;right:10px;top:10px;z-index:99999;background:#0b1220;color:#9fb0c6;border:1px solid #1e293b;padding:4px 6px;border-radius:8px;font:800 11px system-ui}
`); document.head.appendChild(styleEl); mounted=true;
      dbg = el('div',{class:'kq-vb-badge'},'vote-bars: ON'); document.body.appendChild(dbg);
    }

    function reset(){ counts.A=counts.B=counts.C=counts.D=0; total=0; frozen=false; render(true); }

    function mapCards(){
      const nodes = $$(SELECTOR);
      const map = {};
      nodes.forEach(n=>{
        const key = GET_KEY(n);
        if (!key) return;
        const K = key.toUpperCase();
        if (['A','B','C','D'].includes(K) && !map[K]) map[K] = n;
      });
      try{ console.log('[vote-bars] mapped:', Object.keys(map)); }catch{}
      return map;
    }

    function ensureBars(node){
      if(!node.classList.contains('kq-vb-holder')) node.classList.add('kq-vb-holder');
      Array.from(node.children).forEach(ch=>{ if(!ch.classList.contains('kq-vb-wrap')) ch.classList.add('kq-vb-content'); });
      let wrap = node.querySelector(':scope > .kq-vb-wrap');
      if(!wrap){
        wrap = el('div',{class:'kq-vb-wrap'},
          el('div',{class:'kq-vb-fill'}),
          el('div',{class:'kq-vb-meta'},'0%')
        );
        node.insertBefore(wrap, node.firstChild); // bar under content
      }
      return { fill: wrap.querySelector('.kq-vb-fill'), meta: wrap.querySelector('.kq-vb-meta') };
    }

    function percent(v){ return total ? Math.round((v/total)*100) : 0; }

    function render(force){
      const cards = mapCards();
      ['A','B','C','D'].forEach(k=>{
        const node = cards[k]; if(!node) return;
        const bars = ensureBars(node);
        const p = percent(counts[k]);
        if(force || bars.fill._p !== p){
          bars.fill.style.width = p + '%';
          bars.fill._p = p;
          bars.meta.textContent = p + '%';
        }
      });
    }

    function parseVote(text){
      const m = String(text||'').trim().toUpperCase().match(/^[\s\-:]*([ABCD])\b/);
      return m ? m[1] : null;
    }

    function onWs(m){
      if(frozen) return;
      if(!m || m.type!=='chat') return;
      const k = parseVote(m.text); if(!k) return;
      counts[k]+=1; total+=1; render();
    }

    function bindLifecycle(K){
      if(K.on){
        K.on('questionStart', reset);
        K.on('roundStart', reset);
        K.on('questionShown', reset);
        K.on('answerReveal', ()=>{ frozen=true; });
        K.on('questionEnd',  ()=>{ frozen=true; });
      }
      if(K.bus?.on){
        K.bus.on('questionStart', reset);
        K.bus.on('questionShown', reset);
        K.bus.on('answerReveal', ()=>{ frozen=true; });
        K.bus.on('questionEnd',  ()=>{ frozen=true; });
      }
      if(mo){ try{mo.disconnect();}catch{} mo=null; }
      if(document?.body){
        mo = new MutationObserver(()=> render());
        mo.observe(document.body,{subtree:true,childList:true});
      }
    }

    return {
      id:'answerVoteBars',
      name:'Answer Vote Bars',
      description:'Background fill per answer from chat votes.',
      defaultEnabled:true,
      enable(K){
        mountCSS();
        bindLifecycle(K);
        reset();
        if(K.on) K.on('wsMessage', onWs); else if(K.bus?.on) K.bus.on('wsMessage', onWs);
        setTimeout(()=>render(true),80);
      },
      disable(K){
        if(K.off) K.off('wsMessage', onWs); if(K.bus?.off) K.bus.off('wsMessage', onWs);
        if(mo){ try{mo.disconnect();}catch{} mo=null; }
        frozen=true; try{styleEl?.parentNode?.removeChild(styleEl);}catch{} mounted=false; styleEl=null;
        try{dbg?.parentNode?.removeChild(dbg);}catch{} dbg=null;
      }
    };
  }

  function safeStart(){
    if(!document?.body) return setTimeout(safeStart,50);
    const K = window.KQuiz;
    const ready = !!(K && K.registerAddon && (K.on || K.bus?.on));
    if(!ready) return setTimeout(safeStart,120);
    try{ K.registerAddon(factory()); }catch(e){ console.error('[vote-bars] init fail', e); }
  }
  safeStart();
})();
