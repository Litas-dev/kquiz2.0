/* addons/answer-intake-buffer.js
   Answer Intake Buffer v1.4 — minimal dedupe, wide grace, larger drain
   Fix: remove seq-based dedupe. Only dedupe when msgId is present.
*/
(function(){
  function factory(){
    const q = [];
    let draining = false;
    let enabled = true;

    // Tunables
    let drainBudgetMs = 24;   // per-frame budget
    let closeGraceMs = 1200;  // grace after close
    const seenMsg = new Set(); // msgId-only dedupe

    function isSoloActive(){
      const el = document.getElementById('kqSoloPlay');
      return !!(el && !el.classList.contains('kq-hide'));
    }

    function enqueue(m){
      if (!m) return;
      if (m.msgId && seenMsg.has(m.msgId)) return;
      if (m.msgId) seenMsg.add(m.msgId);
      q.push(m);
      if (!draining) { draining = true; requestAnimationFrame(drain); }
    }

    function drain(){
      const K = window.KQuiz;
      const S = K.state.session || (K.state.session = {});
      const nowPerf = performance.now ? ()=>performance.now() : ()=>Date.now();
      const start = nowPerf();

      while (q.length && (nowPerf() - start) < drainBudgetMs){
        const m = q.shift();
        if (!m || m.type !== 'chat') continue;
        if (isSoloActive()) continue;

        // strict parse; ignore hints
        const key = K.util && typeof K.util.parseAnswer === 'function' ? K.util.parseAnswer(m.text) : null;
        if (!key) continue;

        // window with wide grace
        const open = !!S.accepting || (S._closedAt && (Date.now() - S._closedAt) < closeGraceMs);
        if (!open) continue;

        // ensure id via stabilizer
        const ensured = K.util && typeof K.util.ensurePlayer === 'function' ? K.util.ensurePlayer(m) : { id: (m.userId || (m.user && m.user.userId)) };
        const id = ensured && ensured.id ? ensured.id : (m.userId || (m.user && m.user.userId));
        if (!id) continue;

        S.answers = S.answers || {};
        if (S.answers[id] == null){
          S.answers[id] = { key, ts: Date.now(), msgId: m.msgId || null };
        }
      }

      draining = false;
      if (q.length) requestAnimationFrame(drain);
    }

    function mountUI(){
      const grid = document.querySelector('#settings .grid2');
      if (!grid || document.getElementById('aibCard')) return;
      const card = document.createElement('div');
      card.className = 'card'; card.id = 'aibCard';
      card.innerHTML = [
        '<h3 style="margin:0 0 8px">Answer Intake Buffer</h3>',
        '<div class="muted" style="margin-bottom:8px">Eilė + tik msgId dedupe + plati uždarymo malonė.</div>',
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:6px 0">',
          '<label style="display:flex;align-items:center;gap:6px">Užd. malonė <input id="aibGrace" type="number" min="0" value="', closeGraceMs, '" style="width:72px"> ms</label>',
          '<label style="display:flex;align-items:center;gap:6px">Kadro biudžetas <input id="aibBudget" type="number" min="1" value="', drainBudgetMs, '" style="width:72px"> ms</label>',
          '<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="aibToggle" checked> Įjungta</label>',
        '</div>',
        '<div id="aibStatus" class="muted">Paruošta.</div>'
      ].join('');
      grid.appendChild(card);
      card.querySelector('#aibToggle').onchange = e => { enabled = !!e.target.checked; };
      card.querySelector('#aibGrace').onchange = e => { closeGraceMs = Math.max(0, Number(e.target.value||0)); };
      card.querySelector('#aibBudget').onchange = e => { drainBudgetMs = Math.max(1, Number(e.target.value||1)); };
      return card;
    }

    let offChat=null, offStart=null, offEnd=null;
    return {
      id: 'answerIntakeBuffer',
      name: 'Answer Intake Buffer',
      description: 'Serializuoja chat atsakymus, deduplikuoja tik pagal msgId, rašo į S.answers.',
      defaultEnabled: true,
      enable(K){
        mountUI();
        const onChat = (m)=>{ if (enabled && m && m.type==='chat') enqueue(m); };
        K.on('wsMessage', onChat);

        const onStart = ()=>{ const S = K.state.session || (K.state.session = {}); S.accepting = true; S._closedAt = null; };
        const onEnd   = ()=>{ const S = K.state.session || (K.state.session = {}); S._closedAt = Date.now(); };

        try { K.on('questionStarted', onStart); } catch {}
        try { K.on('questionEnded', onEnd); } catch {}

        offChat = ()=>{ try{ K.off('wsMessage', onChat); }catch{} };
        offStart= ()=>{ try{ K.off('questionStarted', onStart); }catch{} };
        offEnd  = ()=>{ try{ K.off('questionEnded', onEnd); }catch{} };
        const s = document.getElementById('aibStatus'); if (s) s.textContent = 'Aktyvuota.';
      },
      disable(){
        try{ offChat&&offChat(); offStart&&offStart(); offEnd&&offEnd(); }catch{}
        const s = document.getElementById('aibStatus'); if (s) s.textContent = 'Išjungta.';
      }
    };
  }
  function register(){ if (!window.KQuiz?.registerAddon) return setTimeout(register,120); window.KQuiz.registerAddon(factory()); }
  register();
})();