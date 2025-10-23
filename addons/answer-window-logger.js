/* addons/answer-window-logger.js
   Answer Window Logger v1.0 — full-window transcript + first-answer capture + optional reconcile
   - Logs ALL chat between questionStarted and questionEnded.
   - For each user, records first valid answer (A–D via K.util.parseAnswer).
   - Exposes UI to export JSON/CSV. Optional toggle to backfill missed answers after round.
   - Non-blocking. No live locking. Skips during Milestone Solo.
*/
(function(){
  function factory(){
    const store = [];            // [{round,qid,opened,closed,rows:[{ts,id,name,text,parsed}]}]
    let cur = null;              // active window
    let offMsg=null, offStart=null, offEnd=null;
    let reconcileOn = false;

    const lc = v => v==null ? null : String(v).toLowerCase();
    const now = ()=> Date.now();

    function isSoloActive(){
      const el = document.getElementById('kqSoloPlay');
      return !!(el && !el.classList.contains('kq-hide'));
    }

    function parseKey(K, t){
      try{
        const r = K.util?.parseAnswer ? K.util.parseAnswer(t) : null;
        return r && /^(A|B|C|D)$/.test(r) ? r : null;
      }catch{ return null; }
    }

    function canonId(m){
      const u = m?.user || {};
      return lc(u.secUid || m.secUid || u.uniqueId || m.uniqueId || m.userId || u.userId || m.uid || m.userId || "user");
    }
    function pickName(m){
      const u = m?.user || {};
      return String(m.displayName || m.nickname || u.nickname || u.uniqueId || m.uniqueId || m.userId || "Žaidėjas");
    }

    // ---------- UI ----------
    function mountUI(){
      const grid = document.querySelector('#settings .grid2');
      if (!grid || document.getElementById('awlCard')) return;
      const card = document.createElement('div');
      card.className='card'; card.id='awlCard';
      card.innerHTML = `
        <h3 style="margin:0 0 8px">Answer Window Logger</h3>
        <div class="muted" style="margin-bottom:8px">
          Logina visą chat'ą per klausimo langą. Žymi pirmą teisingą atsakymą per žaidėją. Galima eksportuoti.
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin:6px 0">
          <label style="display:flex;align-items:center;gap:6px">
            <input type="checkbox" id="awlReconcile"> Po raundo užpildyti trūkstamus atsakymus
          </label>
          <button class="btn" id="awlExportJson">Eksportuoti JSON</button>
          <button class="btn" id="awlExportCsv">Eksportuoti CSV</button>
        </div>
        <div id="awlStatus" class="muted">Paruošta.</div>
        <pre id="awlPeek" style="margin-top:8px;max-height:240px;overflow:auto;font-family:monospace;white-space:pre-wrap"></pre>
      `;
      grid.appendChild(card);
      document.getElementById('awlReconcile').onchange = e => { reconcileOn = !!e.target.checked; };
      document.getElementById('awlExportJson').onclick = exportJson;
            document.getElementById('awlExportCsv').onclick  = exportCsv;
    }

    function exportJson(){
      try{
        const blob = new Blob([JSON.stringify(store, null, 2)], {type:'application/json'});
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), { href:url, download:`answer_windows_${Date.now()}.json` });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(()=>URL.revokeObjectURL(url), 1000);
      }catch{}
    }
    function exportCsv(){
      try{
        const lines = ['round,qid,opened,closed,ts,id,name,text,parsed'];
        store.forEach(w=>{
          (w.rows||[]).forEach(r=>{
            const esc = s => `"${String(s??'').replace(/"/g,'""')}"`;
            lines.push([w.round,w.qid,w.opened,w.closed,r.ts,r.id,esc(r.name),esc(r.text),r.parsed||''].join(','));
          });
        });
        const blob = new Blob([lines.join('\n')], {type:'text/csv'});
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), { href:url, download:`answer_windows_${Date.now()}.csv` });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(()=>URL.revokeObjectURL(url), 1000);
      }catch{}
    }

    function refreshPeek(){
      const box = document.getElementById('awlPeek'); if (!box) return;
      const last = store[store.length-1];
      const rows = last?.rows || [];
      const head = last ? `Round ${last.round} | qid=${last.qid} | rows=${rows.length}\n` : '';
      const tail = rows.slice(-30).map(r => `${new Date(r.ts).toLocaleTimeString()}  ${r.id}  ${r.parsed||'-'}  ${r.text}`).join('\n');
      box.textContent = head + tail;
    }

    // ---------- CORE ----------
    function onStart(){ // questionStarted
      const K = window.KQuiz;
      const round = (K?.state?.session?.round) || 0;
      const qid   = (K?.state?.session?.qid)   || null;
      cur = { round, qid, opened: now(), closed: null, rows: [], firstById: Object.create(null) };
      store.push(cur);
      const s = document.getElementById('awlStatus'); if (s) s.textContent = `Langas atidarytas. Round ${round}.`;
      refreshPeek();
    }

    function onEnd(){ // questionEnded
      if (!cur) return;
      cur.closed = now();
      refreshPeek();

      if (reconcileOn){
        try{
          const K = window.KQuiz;
          const S = K.state.session || (K.state.session = {});
          S.answers = S.answers || {};
          // compute first valid per user from transcript
          const first = {};
          for (const r of cur.rows){
            if (!r.parsed) continue;
            if (first[r.id]) continue;
            first[r.id] = r.parsed;
          }
          // backfill only those missing
          Object.keys(first).forEach(id=>{
            if (S.answers[id] == null){
              S.answers[id] = { key: first[id], ts: cur.closed }; // backfill at close
            }
          });
        }catch{}
      }

      const s = document.getElementById('awlStatus'); if (s) s.textContent = `Langas uždarytas. Surinkta ${cur.rows.length} įrašų.`;
      cur = null;
    }

    function onChat(m){
      try{
        if (!cur) return;                 // outside window
        if (!m || m.type!=='chat') return;
        if (isSoloActive()) return;       // ignore SOLO phase

        const K = window.KQuiz;
        const id = canonId(m);
        const name = pickName(m);
        const text = String(m.text||'');
        const parsed = parseKey(K, text);

        // log row
        cur.rows.push({ ts: now(), id, name, text, parsed });

        // mark first valid for convenience
        if (parsed && !cur.firstById[id]){
          cur.firstById[id] = parsed;
        }

        refreshPeek();
      }catch{}
    }

    return {
      id: 'answerWindowLogger',
      name: 'Answer Window Logger',
      description: 'Logina visą chat’ą per klausimo langą. Žymi pirmą teisingą atsakymą. Pasirinktinai užpildo trūkstamus.',
      defaultEnabled: true,
      enable(K){
        mountUI();
        K.on('wsMessage', onChat);
        try{ K.on('questionStarted', onStart); }catch{}
        try{ K.on('questionEnded', onEnd); }catch{}
        offMsg = ()=>{ try{ K.off('wsMessage', onChat); }catch{} };
        offStart = ()=>{ try{ K.off('questionStarted', onStart); }catch{} };
        offEnd   = ()=>{ try{ K.off('questionEnded', onEnd); }catch{} };
        const s = document.getElementById('awlStatus'); if (s) s.textContent = 'Aktyvuota.';
      },
      disable(){
        try{ offMsg&&offMsg(); offStart&&offStart(); offEnd&&offEnd(); }catch{}
        const s = document.getElementById('awlStatus'); if (s) s.textContent = 'Išjungta.';
      }
    };
  }
  function register(){ if(!window.KQuiz?.registerAddon) return setTimeout(register,120); window.KQuiz.registerAddon(factory()); }
  register();
})();
