/* addons/intake-tap.js
   Intake Tap v1.0 — taps raw WebSocket, mirrors missing chats to wsMessage (deduped)
   Goal: zero chat loss under load. No locks. No SOLO interference.
*/
(function(){
  function factory(){
    const seen = new Set();          // message fingerprint dedupe
    const recent = [];               // small UI buffer
    let relays = 0, rawSeen = 0, dups = 0, errors = 0;

    // Fingerprint: uid|text|tsec
    function fp(msg){
      const u = (msg.userId || msg.user?.userId || msg.user?.uniqueId || msg.user?.secUid || 'x').toString().toLowerCase();
      const t = (msg.text || '').toString();
      const ts = Math.floor((msg.timestamp || Date.now())/1000);
      return `${u}|${t}|${ts}`;
    }

    // Try to project a generic server payload → {type:'chat', ...}
    function asChat(payload){
      if (!payload) return null;
      // common shapes
      const type = payload.type || payload.event || payload.kind;
      if (type && String(type).toLowerCase() !== 'chat') return null;

      const user = payload.user || {};
      const msg = {
        type: 'chat',
        userId: (user.secUid || user.uniqueId || user.userId || payload.userId || payload.uid || '').toString().toLowerCase(),
        user: {
          userId: (user.userId || user.secUid || user.uniqueId || payload.userId || payload.uid || '').toString().toLowerCase(),
          secUid: user.secUid || null,
          uniqueId: user.uniqueId || null,
          nickname: payload.displayName || payload.nickname || user.nickname || ''
        },
        displayName: payload.displayName || payload.nickname || user.nickname || user.uniqueId || payload.uniqueId || '',
        profilePicture: user.profilePicture || user.profilePictureUrl || '',
        profilePictureUrl: user.profilePictureUrl || '',
        text: payload.text || payload.message || '',
        timestamp: payload.ts || payload.timestamp || Date.now()
      };
      if (!msg.userId && !msg.user.userId) return null;
      if (!msg.text) return null;
      return msg;
    }

    // UI
    function mountUI(){
      const grid = document.querySelector('#settings .grid2');
      if (!grid || document.getElementById('itapCard')) return;
      const card = document.createElement('div');
      card.className='card'; card.id='itapCard';
      card.innerHTML = `
        <h3 style="margin:0 0 8px">Intake Tap</h3>
        <div class="muted" style="margin-bottom:8px">Tiesiogiai klausosi WebSocket. Papildo trūkstamus chat įvykius.</div>
        <div id="itapStats" class="muted">raw=0 | relayed=0 | dedup=0 | errors=0</div>
        <pre id="itapLog" style="margin-top:8px;max-height:220px;overflow:auto;font-family:monospace;white-space:pre-wrap"></pre>
      `;
      grid.appendChild(card);
      return [card.querySelector('#itapStats'), card.querySelector('#itapLog')];
    }
    function push(statsEl, logEl, s){
      recent.unshift(s); if (recent.length>60) recent.pop();
      if (logEl) logEl.textContent = recent.join('\n');
      if (statsEl) statsEl.textContent = `raw=${rawSeen} | relayed=${relays} | dedup=${dups} | errors=${errors}`;
    }

    // Wrap all WebSocket onmessage to tap raw payloads
    function patchWebSocket(){
      const NativeWS = window.WebSocket;
      if (!NativeWS || NativeWS.__itap_patched) return;
      function wrapHandler(handler){
        return function(ev){
          try{
            let data = ev && ev.data;
            if (typeof data === 'string'){
              try { data = JSON.parse(data); } catch {}
            }
            // Many transports use arrays/batches
            const batch = Array.isArray(data) ? data : [data];
            batch.forEach(item=>{
              try{
                const chat = asChat(item);
                if (!chat) return;
                rawSeen++;
                const key = fp(chat);
                if (seen.has(key)){ dups++; return; }
                seen.add(key);

                // Let app emit wsMessage first; if none arrives within a tick, relay once.
                let delivered = false;
                const markDelivered = (m)=> {
                  try{
                    const k = fp(m);
                    if (k === key) delivered = true;
                  }catch{}
                };
                // One-shot listener for the mirrored wsMessage
                const onW = (m)=>{ if (m && m.type==='chat') markDelivered(m); };
                const K = window.KQuiz;
                if (K && typeof K.on === 'function'){
                  K.on('wsMessage', onW);
                  setTimeout(()=>{
                    try{ K.off('wsMessage', onW); }catch{}
                    if (!delivered){
                      // Relay a normalized wsMessage (loop-guard flag)
                      const evt = Object.assign({ __itapRelay: true }, chat);
                      try{ K.emit('wsMessage', evt); relays++; }catch{ errors++; }
                    }
                  }, 0);
                }
              }catch{ errors++; }
            });
          }catch{ errors++; }
          // Call original handler
          try{ return handler && handler.apply(this, arguments); }catch{}
        };
      }
      Object.defineProperty(window, 'WebSocket', {
        configurable: true,
        writable: true,
        value: function(url, protocols){
          const ws = new NativeWS(url, protocols);
          const origAdd = ws.addEventListener.bind(ws);
          const origOn  = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ws), 'onmessage');

          // Patch addEventListener('message', ...)
          ws.addEventListener = function(type, listener, options){
            if (type === 'message' && typeof listener === 'function'){
              return origAdd('message', wrapHandler(listener), options);
            }
            return origAdd(type, listener, options);
          };

          // Patch onmessage setter
          Object.defineProperty(ws, 'onmessage', {
            configurable: true,
            get(){ return this.__itap_onmessage || null; },
            set(fn){
              this.__itap_onmessage = typeof fn === 'function' ? wrapHandler(fn) : null;
              origOn.set.call(this, this.__itap_onmessage);
            }
          });

          return ws;
        }
      });
      window.WebSocket.__itap_patched = true;
    }

    let statsEl=null, logEl=null;

    return {
      id: 'intakeTap',
      name: 'Intake Tap',
      description: 'Tiesioginis WebSocket gaudymas. Papildo praleistus chat kadrus.',
      defaultEnabled: true,
      enable(){
        [statsEl, logEl] = mountUI() || [];
        patchWebSocket();
        // Periodically prune old fingerprints
        setInterval(()=>{ if (seen.size>5000){ seen.clear(); } }, 30000);
        push(statsEl, logEl, 'start');
      },
      disable(){
        // cannot unpatch WS safely; just stop logging
        push(statsEl, logEl, 'stopped');
      }
    };
  }
  function register(){ if (!window.KQuiz?.registerAddon) return setTimeout(register,120); window.KQuiz.registerAddon(factory()); }
  register();
})();
