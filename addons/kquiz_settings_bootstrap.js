
/*! KQuiz Settings Bootstrap (force discover) v0.2 */
(function(){
  const ID='milestone-inline', NAME='Lokatoriaus žemėlapis (inline)';
  function force(){
    // 1) Ensure global list for Settings UIs that read window.KQ_ADDONS
    window.KQ_ADDONS = window.KQ_ADDONS || [];
    const enabled = localStorage.getItem('kq_ms_inline_enabled')!=='0';
    const card = {
      id: ID, name: NAME, version: (window.KQuizMilestoneInline?.version||'n/a'),
      enabled,
      toggle: (on)=>{ localStorage.setItem('kq_ms_inline_enabled', on?'1':'0'); },
      run: ()=> window.KQuizMilestoneInline?.runNow?.()
    };
    const i = window.KQ_ADDONS.findIndex(a=>a && a.id===ID);
    if(i>=0) window.KQ_ADDONS[i]=Object.assign(window.KQ_ADDONS[i], card); else window.KQ_ADDONS.push(card);

    // 2) Fire common custom events some Settings panels listen to
    try{ window.dispatchEvent(new CustomEvent('kq:addons:discover')); }catch(_){}
    try{ window.dispatchEvent(new CustomEvent('addons:refresh')); }catch(_){}
    try{ window.dispatchEvent(new Event('change')); }catch(_){}

    // 3) Register with bus API if present
    if(window.KQuiz && typeof window.KQuiz.registerAddon==='function'){
      window.KQuiz.registerAddon({
        id: ID, name: NAME, description:'5×25 s inline mini-žaidimas. +50 geriausiam.',
        defaultEnabled:true,
        enable(){ localStorage.setItem('kq_ms_inline_enabled','1'); },
        disable(){ localStorage.setItem('kq_ms_inline_enabled','0'); }
      });
    }
    console.info('[KQ] Settings bootstrap done for', ID);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', force); else force();
})();