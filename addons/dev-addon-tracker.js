/*! Dev Add-on Tracker
 * Hooks KQuiz.registerAddon to log every registration so you can verify
 * which add-ons actually register at runtime.
 */
(function(){
  "use strict";
  if(window.__KQ_ADDON_TRACKER__) return;
  window.__KQ_ADDON_TRACKER__ = true;

  const PREFIX = "[addon-tracker]";
  const PANEL_ID = "kq-addon-tracker";
  let listEl = null;
  const log = (...args)=>{ try{ console.error(PREFIX, ...args); }catch{} };

  function attach(){
    if(!window.KQuiz || typeof window.KQuiz.registerAddon !== "function"){
      return setTimeout(attach, 120);
    }
    if(window.KQuiz.__REGISTER_PATCHED__) return;
    const original = window.KQuiz.registerAddon.bind(window.KQuiz);
    window.KQuiz.registerAddon = function(manifest){
      try{
        const id = manifest?.id || "(no-id)";
        log("registerAddon called for", id);
        window.__KQ_REGISTER_LOG__ = window.__KQ_REGISTER_LOG__ || [];
        window.__KQ_REGISTER_LOG__.push({ id, ts: Date.now() });
        renderList();
      }catch(e){
        log("tracker error", e);
      }
      return original(manifest);
    };
    window.KQuiz.__REGISTER_PATCHED__ = true;
    log("tracker attached");
  }

  function ensurePanel(){
    if(document.getElementById(PANEL_ID)) return;
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.cssText = [
      "position:fixed",
      "bottom:20px",
      "left:20px",
      "width:240px",
      "max-width:40vw",
      "background:rgba(10,14,24,0.88)",
      "color:#e2e8ff",
      "font:11px/1.4 system-ui,sans-serif",
      "border:1px solid rgba(120,130,160,0.5)",
      "border-radius:10px",
      "padding:8px",
      "box-shadow:0 10px 28px rgba(0,0,0,0.35)",
      "z-index:120001"
    ].join(";");
    const title = document.createElement("div");
    title.textContent = "Registered Add-ons";
    title.style.cssText = "font-weight:700;margin-bottom:6px;text-transform:uppercase;font-size:10px;letter-spacing:.05em;";
    listEl = document.createElement("div");
    listEl.style.cssText = "display:flex;flex-direction:column;gap:4px;max-height:200px;overflow:auto;";
    panel.append(title, listEl);
    document.body.appendChild(panel);
    renderList();
  }

  function renderList(){
    if(!listEl) return;
    listEl.innerHTML = "";
    try{
      const entries = Object.keys(window.KQuiz?.state?.settings?.addons || {}).sort();
      if(!entries.length){
        const empty = document.createElement("div");
        empty.textContent = "(none yet)";
        empty.style.cssText = "color:#94a1c9;font-style:italic;";
        listEl.appendChild(empty);
        return;
      }
      const actual = Object.keys(window.KQuiz?.__addons || {}).sort();
      entries.forEach(id=>{
        const row = document.createElement("div");
        const hasManifest = actual.includes(id);
        const enabled = !!(window.KQuiz?.state?.settings?.addons && window.KQuiz.state.settings.addons[id]);
        row.textContent = `${id}${enabled ? " ✓" : ""}${hasManifest ? "" : " (missing manifest)"}`;
        row.style.cssText = "padding:2px 4px;border-radius:4px;background:rgba(24,32,48,0.6);";
        listEl.appendChild(row);
      });
    }catch{}
  }

  function init(){
    attach();
    if(document.readyState === "loading"){
      document.addEventListener("DOMContentLoaded", ensurePanel, { once:true });
    }else{
      ensurePanel();
    }
  }

  init();
})();
