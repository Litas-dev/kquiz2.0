/*!
 * KQuiz Add-on • Flag Fit Guard (v1.0.0)
 * Purpose: stop flag images from stretching or breaking mobile layout.
 * Scope: applies to images marked as flags in your minis (class="kq-flag") or [data-flag].
 * Behavior: wraps target <img> in a fixed-size responsive box and forces object-fit:contain.
 */
(function(){
  'use strict';
  if(!window.KQuiz || !KQuiz.registerAddon){ console.warn('[flag-fit] KQuiz core not ready'); return; }

  const cfg = {
    id: 'flag-fit-guard',
    name: 'Vėliavų apsauga (mobilui)',
    category: 'Vizualizacija',
    defaultEnabled: true,
    showInSettings: true,
    // layout
    maxW: 'min(88vw, 720px)',
    maxH: 'min(42vh, 420px)',
    border: '1px solid #1E2A3F',
    bg: '#0b1124',
    radius: '12px',
    selectors: ['img.kq-flag','img[data-flag="1"]','img[data-flag]']
  };

  let mo=null, styleEl=null, enabled=false;

  function injectCSS(){
    if(styleEl) return;
    styleEl = document.createElement('style');
    styleEl.id = 'kq-flag-fit-style';
    styleEl.textContent = `
      .kq-flag-box{
        width:${cfg.maxW};
        height:${cfg.maxH};
        max-width:100%;
        display:flex; align-items:center; justify-content:center;
        border-radius:${cfg.radius}; border:${cfg.border};
        background:${cfg.bg}; overflow:hidden;
        contain: layout paint;
      }
      .kq-flag{ display:block; max-width:100%; max-height:100%; width:auto; height:auto; object-fit:contain; image-rendering:auto; }
    `;
    document.head.appendChild(styleEl);
  }

  function isWrapped(img){
    return img && img.parentElement && img.parentElement.classList && img.parentElement.classList.contains('kq-flag-box');
  }

  function wrap(img){
    if(!img || isWrapped(img)) return;
    const box = document.createElement('div');
    box.className = 'kq-flag-box';
    img.parentElement.insertBefore(box, img);
    box.appendChild(img);
    img.classList.add('kq-flag');
  }

  function scan(root){
    try{
      cfg.selectors.forEach(sel=>{
        root.querySelectorAll(sel).forEach(wrap);
      });
    }catch{}
  }

  function enable(){
    enabled = true;
    injectCSS();
    scan(document);
    if(mo) try{ mo.disconnect(); }catch{}
    mo = new MutationObserver((muts)=>{
      for(const m of muts){
        if(m.type==='childList'){
          m.addedNodes && m.addedNodes.forEach(n=>{
            if(!(n instanceof HTMLElement)) return;
            scan(n);
          });
        }
        if(m.type==='attributes' && m.target instanceof HTMLElement){
          scan(m.target);
        }
      }
    });
    mo.observe(document, {subtree:true, childList:true, attributes:true, attributeFilter:['class','data-flag','src']});
  }

  function disable(){
    enabled = false;
    try{ mo && mo.disconnect(); }catch{}
    mo = null;
    // keep wrappers to avoid relayout flashes on toggle
  }

  KQuiz.registerAddon({
    id: cfg.id,
    name: cfg.name,
    description: 'Apgaubia vėliavos paveikslėlį dėžute ir taiko object-fit:contain, kad neištemptų UI.',
    category: cfg.category,
    defaultEnabled: cfg.defaultEnabled,
    showInSettings: cfg.showInSettings,
    configurable: false,
    enable, disable
  });
})();