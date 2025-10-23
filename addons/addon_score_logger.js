/* KQuiz addon: Score Logger v1.1 (compat fix)
   Daily scoreboard persistence with export (JSON/CSV).
   Captures player id, display name, avatar URL, and latest score for the day.
   Stores in localStorage; provides Settings card with controls.
*/
(function(){
  const ADDON_ID = "scoreLogger"; // no hyphen to match existing add-on IDs
  const LS_KEY = "kquiz_scores_daily_v1";
  const LIMIT_DAYS = 30; // retention window

  function todayISO(){
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  }

  function load(){
    try{
      const obj = JSON.parse(localStorage.getItem(LS_KEY)||"{}");
      if (!obj || typeof obj !== 'object') return { days:{} };
      return { days: obj.days || {} };
    }catch{ return { days:{} }; }
  }
  function save(db){
    try{
      const keys = Object.keys(db.days).sort();
      while(keys.length > LIMIT_DAYS){
        const k = keys.shift();
        delete db.days[k];
      }
      localStorage.setItem(LS_KEY, JSON.stringify({ days: db.days }));
    }catch{}
  }

  function ensureDay(db, day){ return (db.days[day] ||= { ts: Date.now(), players:{} }); }
  function csvEsc(v){ const s = String(v ?? ""); return /[",
]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; }

  function exportJSON(db){
    const blob = new Blob([JSON.stringify(db, null, 2)], {type:'application/json;charset=utf-8'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `kquiz-scores-${Date.now()}.json`; a.click(); URL.revokeObjectURL(a.href);
  }
  function exportCSV(db){
    const rows = [["day","userId","name","avatar","score","lastTs"].join(",")];
    for (const [day, rec] of Object.entries(db.days)){
      const ps = rec.players || {};
      for (const [id,p] of Object.entries(ps)){
        rows.push([day,csvEsc(id),csvEsc(p.name||""),csvEsc(p.avatar||""),String(p.score ?? 0),String(p.ts || rec.ts || 0)].join(","));
      }
    }
    const blob = new Blob([rows.join("
")], {type:'text/csv;charset=utf-8'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `kquiz-scores-${Date.now()}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  function mountUI(db){
    const grid = document.querySelector('#settings .grid2');
    if (!grid) return null;
    const card = document.createElement('div');
    card.className = 'card'; card.id = 'scoreLoggerCard';
    card.innerHTML = `
      <h3 style="margin:0 0 8px">Dienos rezultatai</h3>
      <div class="muted" style="margin:0 0 8px">Išsaugo žaidėjų vardus, avatarus ir taškus per dieną. Eksportas JSON/CSV.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0">
        <button class="btn" id="slExportJson">Eksportuoti JSON</button>
        <button class="btn" id="slExportCsv">Eksportuoti CSV</button>
        <button class="btn alt" id="slResetToday">Resetuoti šiandien</button>
        <button class="btn alt" id="slClearAll">Išvalyti viską</button>
      </div>
      <div class="muted">Saugojama dienų: maks. ${LIMIT_DAYS}. Šiandien: <span id="slToday">${todayISO()}</span>. Žaidėjų šiandien: <span id="slCount">0</span></div>`;
    grid.appendChild(card);

    const updateCount = ()=>{
      const d = todayISO();
      const c = (db.days[d] && db.days[d].players) ? Object.keys(db.days[d].players).length : 0;
      const span = card.querySelector('#slCount'); if (span) span.textContent = String(c);
      const t = card.querySelector('#slToday'); if (t) t.textContent = d;
    };

    card.querySelector('#slExportJson').onclick = ()=> exportJSON(db);
    card.querySelector('#slExportCsv').onclick = ()=> exportCSV(db);
    card.querySelector('#slResetToday').onclick = ()=>{ db.days[todayISO()] = { ts: Date.now(), players:{} }; save(db); updateCount(); };
    card.querySelector('#slClearAll').onclick = ()=>{ db.days = {}; save(db); updateCount(); };

    updateCount();
    return { updateCount };
  }

  function factory(){
    let off = null;
    return {
      id: ADDON_ID,
      name: 'Score Logger',
      description: 'Dienos rezultatų registras su eksportu (JSON/CSV).',
      defaultEnabled: true,
      enable(K){
        const db = load();
        const ui = mountUI(db);
        const upsert = (pid, name, avatar, score)=>{
          if (!pid) return;
          pid = String(pid).toLowerCase();
          const day = todayISO();
          const rec = ensureDay(db, day);
          const p = (rec.players[pid] ||= { name: name||pid, avatar: avatar||'', score: 0, ts: 0 });
          if (name && p.name !== name) p.name = name;
          if (avatar) p.avatar = avatar;
          p.score = Number(score||0); p.ts = Date.now(); save(db); ui && ui.updateCount && ui.updateCount();
        };
        const onScore = ({ id, player, after }) => {
          const pid = String(id || player?.id || '').toLowerCase();
          const name = player?.name || K?.state?.players?.[pid]?.name || pid;
          const avatar = player?.avatar || K?.state?.players?.[pid]?.avatar || '';
          const score = (after != null) ? after : (K?.state?.players?.[pid]?.score || 0);
          upsert(pid, name, avatar, score);
        };
        try{ Object.entries(K.state.players||{}).forEach(([pid,p])=> upsert(pid,p.name||pid,p.avatar||'',p.score||0)); }catch{}
        K.on('scoresChanged', onScore);
        off = ()=>{ try{ K.off('scoresChanged', onScore); }catch{} };
      },
      disable(){ try{ off && off(); }catch{} }
    };
  }

  function register(){
    if (!window.KQuiz || !window.KQuiz.registerAddon){ return setTimeout(register, 120); }
    try{ window.KQuiz.registerAddon(factory()); }catch{}
  }

  register();
})();
