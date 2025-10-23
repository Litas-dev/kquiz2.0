/*! Dev Error Overlay (debug only)
 * Floating panel that captures window.onerror, unhandledrejection,
 * and console.error so you can inspect issues without the browser console.
 */
(function(){
  "use strict";
  window.__KQ_LOG_BUFFER__ = window.__KQ_LOG_BUFFER__ || [];

  if(window.__KQ_ERROR_OVERLAY__) return;
  window.__KQ_ERROR_OVERLAY__ = true;

  const PANEL_ID = "kq-error-overlay";
  const MAX_ITEMS = 200;

  function createPanel(){
    if(document.getElementById(PANEL_ID)) return;

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.cssText = [
      "position:fixed",
      "bottom:20px",
      "right:20px",
      "width:360px",
      "max-width:90vw",
      "height:220px",
      "background:rgba(10,14,24,0.94)",
      "color:#f5f7ff",
      "font:12px/1.4 system-ui, sans-serif",
      "border:1px solid rgba(120,130,160,0.6)",
      "border-radius:10px",
      "box-shadow:0 15px 40px rgba(0,0,0,0.45)",
      "display:flex",
      "flex-direction:column",
      "z-index:120000",
      "resize:both",
      "overflow:hidden"
    ].join(";");

    const header = document.createElement("div");
    header.style.cssText = [
      "display:flex",
      "align-items:center",
      "justify-content:space-between",
      "padding:6px 10px",
      "background:rgba(34,48,78,0.9)",
      "cursor:move",
      "user-select:none",
      "font-weight:700",
      "letter-spacing:.04em",
      "text-transform:uppercase",
      "font-size:11px"
    ].join(";");
    header.textContent = "Error Overlay";

    const headerButtons = document.createElement("div");
    headerButtons.style.cssText = "display:flex;gap:6px;align-items:center;";

    const clearBtn = document.createElement("button");
    clearBtn.textContent = "Clear";
    clearBtn.style.cssText = buttonStyle();

    const collapseBtn = document.createElement("button");
    collapseBtn.textContent = "Hide";
    collapseBtn.style.cssText = buttonStyle();

    headerButtons.append(clearBtn, collapseBtn);
    header.appendChild(headerButtons);

    const body = document.createElement("div");
    body.style.cssText = [
      "flex:1",
      "padding:8px",
      "overflow:auto",
      "display:flex",
      "flex-direction:column",
      "gap:6px",
      "background:rgba(13,18,32,0.92)"
    ].join(";");

    panel.append(header, body);
    document.body.appendChild(panel);

    const history = [];

    function logEntry(kind, message, details){
      if(history.length >= MAX_ITEMS){
        history.shift();
        if(body.firstChild) body.removeChild(body.firstChild);
      }
      const item = document.createElement("div");
      item.style.cssText = [
        "border-left:3px solid "+(kind === "error" ? "#f87171" : kind === "promise" ? "#fbbf24" : "#60a5fa"),
        "padding:6px 8px",
        "background:rgba(30,40,60,0.75)",
        "border-radius:6px"
      ].join(";");
      const title = document.createElement("div");
      title.style.cssText = "font-weight:700;font-size:11px;margin-bottom:2px;color:#e2e8ff";
      title.textContent = kind === "error" ? "Error" : (kind === "promise" ? "Unhandled Promise" : "Console");
      const msg = document.createElement("pre");
      msg.style.cssText = "margin:0;font:12px/1.4 'SFMono-Regular',monospace;color:#f1f5ff;white-space:pre-wrap;";
      msg.textContent = message;
      item.append(title, msg);
      if(details){
        const detail = document.createElement("div");
        detail.style.cssText = "margin-top:4px;color:#a5adcb;font-size:11px";
        detail.textContent = details;
        item.appendChild(detail);
      }
      history.push(item);
      body.appendChild(item);
      body.scrollTop = body.scrollHeight;
    }

    clearBtn.addEventListener("click", ()=>{
      history.splice(0, history.length);
      body.innerHTML = "";
    });

    let collapsed = false;
    collapseBtn.addEventListener("click", ()=>{
      collapsed = !collapsed;
      if(collapsed){
        body.style.display = "none";
        panel.style.height = "auto";
        collapseBtn.textContent = "Show";
      }else{
        body.style.display = "flex";
        collapseBtn.textContent = "Hide";
      }
    });

    dragElement(panel, header);

    const backlog = window.__KQ_LOG_BUFFER__;
    if(Array.isArray(backlog)){
      backlog.forEach(entry=> logEntry(entry.kind || "buffer", entry.message || String(entry), entry.details || ""));
    }
    window.__KQ_LOG_BUFFER__ = {
      push(entry){
        if(!entry) return;
        logEntry(entry.kind || "buffer", entry.message || String(entry), entry.details || "");
      }
    };
    window.__KQ_LOG_EMITTER__ = logEntry;

    installHandlers(logEntry);
  }

  function buttonStyle(){
    return [
      "border:none",
      "background:rgba(255,255,255,0.12)",
      "color:#f8fafc",
      "font-size:11px",
      "padding:4px 8px",
      "border-radius:6px",
      "cursor:pointer"
    ].join(";");
  }

  function dragElement(panel, handle){
    let posX=0, posY=0, mouseX=0, mouseY=0;
    handle.addEventListener("mousedown", startDrag);
    function startDrag(e){
      e.preventDefault();
      mouseX = e.clientX;
      mouseY = e.clientY;
      document.addEventListener("mousemove", drag);
      document.addEventListener("mouseup", stopDrag);
    }
    function drag(e){
      e.preventDefault();
      posX = mouseX - e.clientX;
      posY = mouseY - e.clientY;
      mouseX = e.clientX;
      mouseY = e.clientY;
      const rect = panel.getBoundingClientRect();
      const left = rect.left - posX;
      const top = rect.top - posY;
      panel.style.left = Math.max(0, Math.min(window.innerWidth - rect.width, left)) + "px";
      panel.style.top = Math.max(0, Math.min(window.innerHeight - rect.height, top)) + "px";
      panel.style.bottom = "auto";
      panel.style.right = "auto";
    }
    function stopDrag(){
      document.removeEventListener("mousemove", drag);
      document.removeEventListener("mouseup", stopDrag);
    }
  }

  function installHandlers(log){
    window.addEventListener("error", (ev)=>{
      const msg = ev.message || String(ev.error || "Unknown");
      const detail = ev.filename ? `${ev.filename}:${ev.lineno || 0}:${ev.colno || 0}` : "";
      log("error", msg, detail);
    });

    window.addEventListener("unhandledrejection", (ev)=>{
      let reason = ev.reason;
      if(reason && reason.stack) reason = reason.stack;
      if(typeof reason !== "string") reason = JSON.stringify(reason, null, 2);
      log("promise", reason || "Unhandled promise rejection");
    });

    const origError = console.error;
    console.error = function(...args){
      try{
        const msg = args.map(arg=>{
          if(arg instanceof Error){
            return arg.stack || arg.message;
          }
          if(typeof arg === "object"){
            try{ return JSON.stringify(arg); }catch{return String(arg);}
          }
          return String(arg);
        }).join(" ");
        log("console", msg);
      }catch{}
      return origError.apply(console, args);
    };
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", createPanel, { once:true });
  }else{
    createPanel();
  }
})();
