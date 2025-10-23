/* addons/chat-recorder.js
   Chat Recorder v2.3 — add-on wrapper, canonical IDs, strict parse, avatar-safe analytics
   Purpose:
     • Ingest live chat (read-only)
     • Canonicalize IDs (secUid→uniqueId→userId, lowercase)
     • Use global strict single-symbol parser (from addons/adon.js) to annotate `parsed`
     • Emit ONLY `recordedChat` for analytics/locker pipeline
     • Preserve avatars across legacy keys
   Non-Goals:
     • Do NOT emit `wsMessage` (prevents double-piping)
     • Do NOT lock answers; core/solo own locking
*/

(function () {
  function factory() {
    const LIMIT = 2000;
    const log = [];
    let currRound = 0, currQid = null;
    let off = null;

    // helpers
    const lc = (x) => (x == null ? null : String(x).toLowerCase());
    function canonId(m) {
      const u = m?.user || {};
      return lc(
        u.secUid || m.secUid ||
        u.uniqueId || m.uniqueId ||
        m.userId || u.userId || m.uid || "user"
      );
    }
    function pickName(m) {
      const u = m?.user || {};
      return String(
        m.displayName || m.nickname || u.nickname ||
        u.uniqueId || m.uniqueId || m.userId || "Žaidėjas"
      );
    }
    function pickAvatar(m) {
      const u = m?.user || {};
      return (
        m.profilePicture || m.profilePictureUrl || m.userProfilePictureUrl ||
        m.avatar || u.profilePicture || u.profilePictureUrl ||
        (u.avatarLarger && u.avatarLarger.urlList && u.avatarLarger.urlList[0]) ||
        (u.avatarMedium && u.avatarMedium.urlList && u.avatarMedium.urlList[0]) ||
        (u.avatarThumb && u.avatarThumb.urlList && u.avatarThumb.urlList[0]) ||
        ""
      );
    }
    function strictParse(text) {
      const util = window.KQuiz?.util || {};
      const r = typeof util.parseAnswer === "function" ? util.parseAnswer(text) : null;
      return r && /^(A|B|C|D)$/.test(r) ? r : null;
    }

    // settings card
    function mountUI() {
      const grid = document.querySelector("#settings .grid2");
      if (!grid || document.getElementById("recCard")) return;
      const card = document.createElement("div");
      card.className = "card"; card.id = "recCard";
      card.innerHTML = `
        <h3 style="margin:0 0 8px">Chat Recorder</h3>
        <div class="muted" style="margin-bottom:8px">
          Normalizuoja ID, saugo avatarus, ir emituoja <code>recordedChat</code>. Nerašo atsakymų. Nepertransliuoja <code>wsMessage</code>.
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0">
          <button class="btn" id="recSnap">Rodyti paskutinius</button>
        </div>
        <div id="recStatus" class="muted">Paruošta.</div>
        <pre id="recOut" style="margin-top:8px;display:none;max-height:240px;overflow:auto"></pre>
      `;
      grid.appendChild(card);
      const out = card.querySelector("#recOut");
      card.querySelector("#recSnap").onclick = () => {
        out.style.display = out.style.display === "none" ? "block" : "none";
        out.textContent = JSON.stringify(log.slice(-50), null, 2);
      };
      return card;
    }

    function onAnyMessage(m) {
      try {
        if (!m || m.type !== "chat") return;

        const id = canonId(m);
        const name = pickName(m);
        const avatar = pickAvatar(m);
        const text = String(m.text || "");
        const parsed = strictParse(text) || "";

        // Recorder analytics mirror ONLY. Do NOT emit wsMessage here.
        window.KQuiz.emit("recordedChat", {
          ts: Date.now(),
          userId: id,
          user: {
            userId: id,
            secUid: m.user?.secUid || m.secUid || null,
            uniqueId: m.user?.uniqueId || m.uniqueId || null,
            nickname: name,
            profilePictureUrl: avatar
          },
          displayName: name,
          profilePicture: avatar,
          profilePictureUrl: avatar,
          userProfilePictureUrl: avatar,
          text,
          parsed,
          round: currRound,
          qid: currQid
        });

        // Local ring buffer
        log.push({ ts: Date.now(), round: currRound, qid: currQid, userId: id, name, text, parsed, avatar });
        if (log.length > LIMIT) log.splice(0, log.length - LIMIT);
      } catch {}
    }

    return {
      id: "chatRecorder",
      name: "Chat Recorder",
      description: "Normalizuoja ID, saugo avatarus, emituoja recordedChat. Be wsMessage retransliavimo.",
      defaultEnabled: true,
      enable(K) {
        mountUI();
        try {
          K.on("questionStarted", ({ qid, round }) => { currQid = qid || null; currRound = round || (currRound + 1); });
          K.on("questionEnded", () => { currQid = null; });
        } catch {}
        K.on("wsMessage", onAnyMessage);
        off = () => { try { K.off("wsMessage", onAnyMessage); } catch {} };
        const s = document.getElementById("recStatus"); if (s) s.textContent = "Aktyvuota.";
      },
      disable() {
        try { off && off(); } catch {}
        const s = document.getElementById("recStatus"); if (s) s.textContent = "Išjungta.";
      }
    };
  }

  function register() {
    if (!window.KQuiz?.registerAddon) return setTimeout(register, 120);
    window.KQuiz.registerAddon(factory());
  }
  register();
})();
