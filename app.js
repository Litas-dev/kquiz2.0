/* KQuiz core v3.0 */
"use strict";
const GRACE_MS = 2000; // +2 s po nulio
const players = window.players || (window.players = Object.create(null));

function upsertPlayer(msg) {
  // Determine a stable player ID (prefer secUid or uniqueId)
  let id = msg.user?.secUid || msg.secUid || msg.uniqueId || msg.user?.uniqueId || msg.userId || msg.user?.userId;
  if (!id) return null;
  if (typeof id !== "string") id = String(id);
  if (id.length <= 30) id = id.toLowerCase();

  const name =
    msg.displayName ||
    msg.user?.displayName ||
    msg.user?.nickname ||
    msg.user?.uniqueId ||
    "Guest";

  const p = players[id] || (players[id] = { id: String(id), name, pfp: null, answers: 0, last: 0 });
  if (p.name !== name) p.name = name;

  const url = msg.profilePicture || msg.avatar || msg.user?.profilePicture;
  if (url) p.pfp = url; // never overwrite with falsy
  p.last = Date.now();
  return p;
}


// Helpers
const $ = (q, r = document) => r.querySelector(q);
const $$ = (q, r = document) => Array.from(r.querySelectorAll(q));
const el = (t, a = {}, ...cs) => {
  const n = document.createElement(t);
  Object.entries(a).forEach(([k, v]) => (k === "class" ? (n.className = v) : n.setAttribute(k, v)));
  cs.forEach((c) => n.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
  return n;
};
function applyVipMetadata(node, player) {
  if (!node || !player) return;
  const uid = String(player.id || player.uid || "");
  const name = player.name || player.displayName || "";
  try {
    if (node.dataset) {
      node.dataset.uid = uid;
      node.dataset.name = name;
    }
  } catch {}
  node.setAttribute("data-uid", uid);
  node.setAttribute("data-name", name);
  if (!node.title && name) node.title = name;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Event bus / plugin API
const _bus = {};
function on(evt, fn) { (_bus[evt] ||= []).push(fn); }
function off(evt, fn) { const a = _bus[evt] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
function emit(evt, payload) { (_bus[evt] || []).forEach((f) => { try { f(payload); } catch {} }); }
function use(plugin) { try { plugin(window.KQuiz); } catch {} }

let chatGuard = null;

const state = {
  settings: { secsPerQuestion: 20, autoNext: false, sounds: { ticking: true, fail: true }, liveMode: false, chatSafe: 120, addons: {} },
  bank: [],
  players: {},
  session: {
    deck: [],
    i: 0,
    open: false,
    timerRunning: false,
    correctKey: "A",
    answers: {},
    counts: { A: 0, B: 0, C: 0, D: 0 },
    done: 0,
    shownTop: {},
    used: {},
    curr: null
  },
  ws: null,
  wsOk: false
};

function save() {
  try { localStorage.setItem("kquiz", JSON.stringify({ settings: state.settings })); } catch {}
}
function restore() {
  try {
    const s = JSON.parse(localStorage.getItem("kquiz") || "{}");
    if (s.settings) Object.assign(state.settings, s.settings);
  } catch {}
  const autoNextEl = $("#autoNext");
  const secsEl = $("#secsPerQ");
  const tickEl = $("#sndTick");
  const failEl = $("#sndFail");
  const liveEl = $("#liveMode");
  const chatSafeEl = $("#chatSafe");
  if (autoNextEl) autoNextEl.checked = !!state.settings.autoNext;
  if (secsEl) secsEl.value = state.settings.secsPerQuestion;
  if (tickEl) tickEl.checked = !!state.settings.sounds.ticking;
  if (failEl) failEl.checked = !!state.settings.sounds.fail;
  if (liveEl) liveEl.checked = !!state.settings.liveMode;
  if (chatSafeEl) chatSafeEl.value = state.settings.chatSafe || 120;
  applyLiveSettings();
}

document.addEventListener("DOMContentLoaded", () => {
  restore();
  const hamburger = $("#hamburger");
  if (hamburger) hamburger.addEventListener("click", () => toggleMenu());
  try { refreshAddonsUI && refreshAddonsUI(); } catch {}
  emit("init");
  KQuiz.on("recordedChat", (m) => {
  handleChat({
    type: "chat",
    text: String(m.text || ""),
    userId: m.userId,
    user: m.user || {},
    parsedAnswer: m.parsed || m.parsedAnswer || null
  });
});
});

// Nav
function nav(id) { $$(".section").forEach((s) => s.classList.remove("active")); $("#" + id).classList.add("active"); }
function toggleMenu(force) {
  const sidebar = $("#sidebar");
  const open = typeof force === "boolean" ? force : !sidebar.classList.contains("open");
  sidebar.classList.toggle("open", open);
}

// Data
async function loadJSON(file) {
  if (!file) return;
  const text = await file.text();
  let data = [];
  try { data = JSON.parse(text); if (!Array.isArray(data)) throw 0; } catch {
    alert("Blogas JSON."); return;
  }
  const out = []; const seen = new Set();
  for (const o of data) {
    if (!o || !o.q || seen.has(o.q)) continue;
    seen.add(o.q);
    const wrong = Array.isArray(o.wrong) ? o.wrong.slice(0, 3) : [];
    while (wrong.length < 3) wrong.push("");
    out.push({ q: String(o.q), correct: String(o.correct || ""), wrong, note: String(o.note || ""), cat: String(o.cat || "") });
  }
  if (!out.length) { alert("Klausimų nerasta."); return; }
  state.bank = out;
  state.session.deck = shuffle([...Array(out.length).keys()]);
  state.session.i = 0; state.session.used = {}; state.session.done = 0; state.session.curr = null;
  $("#bankStat").textContent = `Įkelta ${out.length} klausimų.`;
  $("#roundNum").textContent = "0";
}

// Timer / rounds
let timer = null, timeLeft = 0, totalTime = 0;
function startGame() {
  if (!state.bank.length) { alert("Įkelkite JSON banką Nustatymuose."); return; }
  if (state.session.i >= state.session.deck.length) {
    state.session.deck = shuffle([...Array(state.bank.length).keys()]);
    state.session.i = 0; state.session.used = {}; state.session.done = 0;
  }
  nav("game");
  nextQ();
}
function cancelAuto() { if (window.autoNextTimer) { clearTimeout(window.autoNextTimer); window.autoNextTimer = null; } }
function bootTimer() {
  timeLeft = parseInt(state.settings.secsPerQuestion) || 20; totalTime = timeLeft;
  state.session.timerRunning = true; updateTimerUI(); tickStart();
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    timeLeft--; updateTimerUI();
    if (timeLeft <= 0) {
      clearInterval(timer); timer = null;
      state.session.timerRunning = false;
      tickStop();
      const hold = typeof GRACE_MS === "number" ? GRACE_MS : 2000;
      setTimeout(() => { if (state.session.open) reveal(true); }, hold);
    }
  }, 1000);
}
function updateTimerUI() {
  $("#tLeft").textContent = String(Math.max(0, timeLeft));
  const pct = totalTime ? (100 * (totalTime - timeLeft) / totalTime) : 0;
  $("#timerFill").style.width = `${pct}%`;
}
function nextQ() {
  // FIX: visada nuvalyk bet kokį likusį guard’ą prieš naują klausimą
  try { if (typeof clearChatGuard === "function") clearChatGuard(); } catch {}

  cancelAuto();
  state.session.open = true;
  while (state.session.i < state.session.deck.length && state.session.used[state.session.deck[state.session.i]]) {
    state.session.i++;
  }
  if (state.session.i >= state.session.deck.length) { finish(); return; }

  const qid = state.session.deck[state.session.i];
  const q = state.bank[qid];
  const opts = [q.correct, ...(q.wrong || [])].slice(0, 4);
  while (opts.length < 4) opts.push("");
  const ord = [0, 1, 2, 3]; shuffle(ord);
  const keys = ["A", "B", "C", "D"];

  $("#q").textContent = q.q;
  const box = $("#ans"); box.innerHTML = "";
  ord.forEach((oi, i) => {
    box.appendChild(el("div", { class: "choice" },
      el("div", { class: "key" }, keys[i]), opts[oi]
    ));
  });

  const cKey = keys[ord.indexOf(0)] || "A";
  state.session.correctKey = cKey;
  state.session.answers = {};
  state.session.counts = { A: 0, B: 0, C: 0, D: 0 };
  state.session.curr = { qid, correctKey: cKey, correctText: q.correct || "", note: q.note || "" };

  KQuiz.emit("questionStart", { qid });

  $("#lockBtn").classList.remove("hidden");
  $("#revealBtn").classList.remove("hidden");
  $("#nextBtn").classList.add("hidden");
  bootTimer();
}
function lockNow() {
  state.session.open = false;
  state.session.timerRunning = false;
  if (timer) { clearInterval(timer); timer = null; }
  tickStop();
  $("#lockBtn").classList.add("hidden");
}
function reveal(auto) {
  if (timer) { clearInterval(timer); timer = null; }
  state.session.timerRunning = false;
  tickStop();
  lockNow();

  const curr = state.session.curr;
  const correct = curr ? curr.correctKey : state.session.correctKey;
  const winners = [];
  for (const [id, k] of Object.entries(state.session.answers || {})) {
    const p = state.players[id] || (state.players[id] = { name: id, score: 0, nextMilestone: 100, avatar: "" });
    const before = p.score || 0;
    if (k === correct) {
      p.score = before + 10;
      winners.push({ id, name: p.name || id, score: p.score, avatar: p.avatar || "" });
    }
    emit("scoresChanged", { id, before, after: p.score || 0, player: p, correct: (k === correct) });
    if (p.score >= (p.nextMilestone || 100)) {
      p.nextMilestone = (p.nextMilestone || 100) + 100;
    }
  }

  try { if (curr) state.session.used[curr.qid] = true; } catch {}
  $("#ovAnswer").textContent = curr ? curr.correctText : "";
  $("#ovNote").textContent = curr ? curr.note : "";
  const box = $("#ovWinners"); box.innerHTML = "";
  if (winners.length) {
    winners.sort((a, b) => b.score - a.score);
    winners.forEach((w) => {
      let avatarEl;
      if (w.avatar) {
        avatarEl = el("img", {
          class: "av kq-av kquiz-avatar",
          src: w.avatar,
          alt: w.name || "",
          referrerpolicy: "no-referrer",
          loading: "lazy",
          onerror: "this.remove()"
        });
      } else {
        avatarEl = el("div", {
          class: "av kq-av avatar",
          style: "width:32px;height:32px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);display:inline-block;"
        });
      }
      applyVipMetadata(avatarEl, w);

      const nameWrap = el("div", { style: "display:flex;align-items:center;gap:6px;" }, w.name);
      try {
        window.KQ_VIP?.decorateLabel?.(nameWrap, { uid: w.id, id: w.id, name: w.name });
      } catch {}

      const left = el("div", { class: "rowL" }, avatarEl, nameWrap);
      box.appendChild(el("div", { class: "row" }, left, el("div", {}, String(w.score))));
    });
  } else {
    box.appendChild(el("div", { class: "row" }, el("div", {}, "Niekas neatsakė teisingai"), el("div", {}, "0")));
    if (state.settings.sounds.fail) {
      try { const f = $("#failAudio"); f.currentTime = 0; f.play(); } catch {}
    }
  }
  $("#overlay").style.display = "flex";
  $("#nextBtn").classList.remove("hidden");
  save();

  try { window.KQ_VIP?.scan?.(); } catch {}

  if (state.settings.autoNext && auto) {
    window.autoNextTimer = setTimeout(() => {
      if ($("#overlay").style.display !== "none") {
        $("#overlay").style.display = "none";
        proceed();
      }
    }, 3000);
  }
  emit("questionEnd", { qid: curr ? curr.qid : null, correctKey: correct });
}
function proceed() {
  $("#overlay").style.display = "none";
  state.session.i++;
  state.session.done++;
  state.session.curr = null;
  $("#roundNum").textContent = String(state.session.done);
  save();
  nextQ();
}
function finish() {
  $("#q").textContent = "Klausimai baigėsi.";
  $("#ans").innerHTML = "";
  $("#lockBtn").classList.add("hidden");
  $("#revealBtn").classList.add("hidden");
  $("#nextBtn").classList.add("hidden");
}

// Audio
function tickStart() {
  if (!state.settings.sounds.ticking) return;
  try { const a = $("#tickAudio"); a.currentTime = 0; a.play(); } catch {}
}
function tickStop() {
  try { $("#tickAudio").pause(); } catch {}
}

// WS bridge
function connectWS() {
  const url = ($("#wsUrl").value || "").trim() || "ws://localhost:8081";
  let attempts = 0;
  function dial() {
    try { if (state.ws) state.ws.close(); } catch {}
    const ws = new WebSocket(url);
    state.ws = ws;
    $("#wsState").textContent = "jungiamasi...";
    ws.onopen = () => {
      attempts = 0;
      state.wsOk = true;
      $("#wsState").textContent = "prijungta";
      emit("wsOpen");
    };
    ws.onclose = ws.onerror = () => {
      state.wsOk = false;
      $("#wsState").textContent = "neprijungta";
      emit("wsClosed");
      setTimeout(dial, Math.min(10000, 1000 * (2 ** (attempts++))));
    };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        emit("wsMessage", m);
      //   if (m.type === "chat") handleChat(m);
      } catch {}
    };
  }
  dial();
}

// Players / answers
function ensurePlayer(msg) {
  // Determine a stable player ID (prefer msg.userId from server)
  let id = msg.userId || msg.user?.userId || msg.user?.secUid || msg.secUid || msg.user?.uniqueId || msg.uniqueId || msg.uid || "user";
  if (typeof id !== "string") id = String(id);
  const canon = id.length > 30 ? id : id.toLowerCase();

  const name =
    msg.displayName ||
    msg.nickname ||
    msg.uniqueId ||
    msg.user?.displayName ||
    msg.user?.nickname ||
    msg.user?.uniqueId ||
    msg.userId ||
    "Žaidėjas";

  // Map all possible profile-picture fields (new + legacy)
  const incomingAvatar =
    msg.profilePicture || // canonical from updated server
    msg.avatar || // legacy key
    msg.profilePictureUrl || // some libs
    msg.userProfilePictureUrl || // some libs
    msg.user?.profilePicture || // nested canonical
    msg.user?.profilePictureUrl || // nested variant
    msg.user?.avatarLarger?.urlList?.[0] || // legacy nested
    msg.user?.avatarMedium?.urlList?.[0] ||
    msg.user?.avatarThumb?.urlList?.[0] ||
    "";

  let p = state.players[canon];
  if (!p) {
    p = state.players[canon] = { name, score: 0, nextMilestone: 100, avatar: "" };
  } else {
    if (name && p.name !== name) p.name = name;
  }
  // Only set if truthy to avoid blanking an existing good URL
  if (incomingAvatar) p.avatar = incomingAvatar;

  return { id: canon, p };
}

// FIX: parser priima A/B/C/D ir 1–4 įvairiais formatais (emoji, su skliaustais, Cyrillic ir t.t.)
function parseAnswer(raw) {
  if (!raw) return null;
  let t = String(raw).toUpperCase();

  // pašalink zero-width ir diakritikus
  t = t.replace(/[\u200B-\u200D\uFE0E\uFE0F]/g, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Cyrillic ir full-width raidės į lotyniškas
  const map = { "А": "A", "В": "B", "С": "C", "Д": "D", "Ａ": "A", "Ｂ": "B", "Ｃ": "C", "Ｄ": "D" };
  t = t.split("").map(ch => map[ch] || ch).join("");

  // emoji skaičiai 1️⃣–4️⃣ -> 1–4
  t = t.replace(/([0-4])\ufe0f?\u20e3/g, "$1");

  // priimk: "A", "b)", "C:", " 2 ", "3.", "4 )"
  const m = t.match(/(?:^|[^A-Z0-9])([ABCD])(?:[^A-Z0-9]|$)|(?:^|[^0-9])([1-4])(?:[^0-9]|$)/);
  if (!m) return null;
  return m[1] || ["A", "B", "C", "D"][parseInt(m[2], 10) - 1];
}

function handleChat(msg) {
  // plugin guard
  if (typeof chatGuard === "function") {
    const consumed = !!chatGuard(msg, { parseAnswer, ensurePlayer, state });
    if (consumed) return;
  }
  if (!state.session.timerRunning || !state.session.open) return;
  const { id } = ensurePlayer(msg);
  if (state.session.answers[id]) return;
  const key = (msg.parsedAnswer || parseAnswer(String(msg.text || "")));
  if (!key) return;
  state.session.answers[id] = key;
  state.session.counts[key] = (state.session.counts[key] || 0) + 1;
}

// Keyboard
window.addEventListener("keydown", (e) => {
  if (e.key === " ") {
    e.preventDefault();
    if ($("#overlay").style.display === "flex") proceed();
    else reveal(false);
  }
});

// Live/TikTok helpers
function applyLiveSettings() {
  const v = Math.max(0, parseInt(state.settings.chatSafe) || 0);
  document.documentElement.style.setProperty("--safe-bottom", v + "px");
  document.body.classList.toggle("live", !!state.settings.liveMode);
  const small = window.innerHeight < 740;
  document.body.classList.toggle("compact", small || !!state.settings.liveMode);
}
function toggleLive(on) { state.settings.liveMode = !!on; save(); applyLiveSettings(); }
function setChatSafe(n) { state.settings.chatSafe = clamp(parseInt(n) || 0, 0, 400); save(); applyLiveSettings(); }
window.addEventListener("resize", applyLiveSettings);

// Control surface for plugins
function pauseMain() {
  state.session.open = false;
  if (timer) { try { clearInterval(timer); } catch {} timer = null; }
  state.session.timerRunning = false;
  tickStop();
}
function resumeFlow() { nextQ(); }
function nextQuestionNow() { $("#overlay").style.display = "none"; proceed(); }
function setChatGuard(fn) { chatGuard = fn; }
function clearChatGuard() { chatGuard = null; }
function getRandomQuestion() {
  const n = state.bank.length;
  if (!n) return null;
  const i = Math.floor(Math.random() * n);
  const q = state.bank[i];
  const opts = [q.correct, ...(q.wrong || [])].slice(0, 4);
  while (opts.length < 4) opts.push("");
  const ord = [0, 1, 2, 3]; shuffle(ord);
  const keys = ["A", "B", "C", "D"];
  return { q: q.q, note: q.note || "", options: ord.map((oi) => opts[oi]), keys, correctKey: keys[ord.indexOf(0)] || "A", correctText: q.correct || "" };
}

// Addon registry
const addons = {};
function registerAddon(manifest) {
  if (!manifest || !manifest.id) return;
  const id = manifest.id;
  addons[id] = manifest;
  state.settings.addons = state.settings.addons || {};
  const enabled = (id in state.settings.addons) ? !!state.settings.addons[id] : (manifest.defaultEnabled ?? true);
  state.settings.addons[id] = enabled;
  if (enabled && typeof manifest.enable === "function") {
    try { manifest.enable(window.KQuiz); } catch {}
  }
  refreshAddonsUI();
}
function setAddonEnabled(id, on) {
  if (!addons[id]) return;
  state.settings.addons = state.settings.addons || {};
  const was = !!state.settings.addons[id];
  state.settings.addons[id] = !!on;
  save();
  try {
    if (on && !was && typeof addons[id].enable === "function") addons[id].enable(window.KQuiz);
    if (!on && was && typeof addons[id].disable === "function") addons[id].disable();
  } catch {}
  refreshAddonsUI();
}
function refreshAddonsUI() {
  const box = document.getElementById("addonsList");
  if (!box) return;
  box.innerHTML = "";
  Object.values(addons).forEach((m) => {
    const row = el("div", { class: "addonItem" });
    const cb = el("input", { type: "checkbox" });
    cb.checked = !!(state.settings.addons && state.settings.addons[m.id]);
    cb.addEventListener("change", (e) => setAddonEnabled(m.id, e.target.checked));
    const meta = el("div", { class: "addonMeta" },
      el("div", { class: "addonName" }, m.name || m.id),
      el("div", { class: "addonDesc" }, m.description || "")
    );
    row.appendChild(cb);
    row.appendChild(meta);
    box.appendChild(row);
  });
}

// Expose API
window.KQuiz = {
  state, on, off, emit, use,
  util: { el, $, $$, shuffle, clamp, parseAnswer },
  control: { pauseMain, resumeFlow, nextQuestionNow, setChatGuard, clearChatGuard, getRandomQuestion },
  registerAddon, setAddonEnabled
};
window.KQuiz.__addons = addons;
