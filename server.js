// server.js - Plain WebSocket relay for KQuiz (Node >=18, CJS)
require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

// --- TikTok connector import shim (works for v1/v2, CJS/ESM) ---
const tlc = require('tiktok-live-connector');
const TikTokCtor =
  tlc?.default ||
  tlc?.WebcastPushConnection ||
  tlc?.TikTokLiveConnection ||
  tlc;

// --- Config ---
const PORT = Number(process.env.PORT || 8091);
let USER = (process.env.TT_USERNAME || safeConfigUser()).replace(/^@+/, '');
if (!USER) {
  console.error('Set TT_USERNAME env or config.json {"username":"handle"} (no @).');
  process.exit(1);
}

// --- App + HTTP server ---
const app = express();
const server = http.createServer(app);

const PUBLIC_DIR = path.join(__dirname, 'public');
const KQUIZ_DIR = path.join(PUBLIC_DIR, 'kquiz');

// Serve the KQuiz UI by default and keep helpers accessible
app.get('/', (_req, res) => res.redirect('/kquiz/'));
app.use('/kquiz', express.static(KQUIZ_DIR));
app.use(express.static(PUBLIC_DIR));

// Simple health
app.get('/health', (_req, res) => res.json({ ok: true, user: USER }));

// Avatar proxy using global fetch (Node 18+)
app.get('/img', async (req, res) => {
  const u = String(req.query.u || '');
  if (!/^https?:\/\//i.test(u)) return res.status(400).end('bad url');
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    res.status(r.status);
    r.headers.forEach((v, k) => {
      if (!/^content-security-policy|x-/i.test(k)) res.setHeader(k, v);
    });
    r.body.pipe(res);
  } catch {
    res.status(502).end('proxy fail');
  }
});

// --- WS hub at /stream with 20s resend buffer ---
const wss = new WebSocketServer({ server, path: '/stream' });
const clients = new Set();
let seq = 0;
const buffer = [];                 // {ts, obj}
const BUF_MS = 20000;
const BUF_MAX = 10000;

function pushBuffer(obj) {
  const now = Date.now();
  buffer.push({ ts: now, obj });
  while (buffer.length && now - buffer[0].ts > BUF_MS) buffer.shift();
  while (buffer.length > BUF_MAX) buffer.shift();
}
function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const ws of clients) if (ws.readyState === 1) ws.send(s);
}

wss.on('connection', (ws) => {
  clients.add(ws);
  // warm replay
  for (const it of buffer) ws.send(JSON.stringify(it.obj));
  ws.on('close', () => clients.delete(ws));
});

// --- TikTok intake ---
const conn = new TikTokCtor(USER, {
  disableEulerFallbacks: true,
  requestOptions: { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } },
});

function canonId(m) {
  const u = m?.user || {};
  const id =
    u.secUid || m.secUid || u.uniqueId || m.uniqueId || m.userId || u.userId || '';
  return String(id).toLowerCase();
}
function pickName(m) {
  const u = m?.user || {};
  const fallback = m.displayName || m.nickname || u.nickname || u.uniqueId || m.uniqueId;
  return String(fallback || 'Player');
}
function pickAvatar(m) {
  const u = m?.user || {};
  return (
    m.profilePictureUrl ||
    m.profilePicture ||
    u.profilePictureUrl ||
    u.profilePicture ||
    (u.avatarLarger && u.avatarLarger.urlList && u.avatarLarger.urlList[0]) ||
    (u.avatarMedium && u.avatarMedium.urlList && u.avatarMedium.urlList[0]) ||
    (u.avatarThumb && u.avatarThumb.urlList && u.avatarThumb.urlList[0]) ||
    ''
  );
}

// helper to normalize user for other event types
function normUser(raw) {
  const u = raw?.user || {};
  return {
    userId: String(u.userId || raw.userId || '').toLowerCase(),
    uniqueId: u.uniqueId || raw.uniqueId || '',
    secUid: u.secUid || raw.secUid || null,
    nickname: u.nickname || raw.nickname || u.uniqueId || '',
    profilePictureUrl: pickAvatar(raw),
  };
}
const emit = (obj) => {
  pushBuffer(obj);
  broadcast(obj);
};

// --- CHAT ---
conn.on('chat', (raw) => {
  const text = String(raw.comment || raw.text || '').trim();
  if (!text) return;

  const id = canonId(raw);
  const name = pickName(raw);
  const avatar = pickAvatar(raw);
  const msgId =
    String(raw.msgId || raw.eventId || `${id}|${text}|${Math.floor(Date.now() / 1000)}`);

  const obj = {
    type: 'chat',
    msgId,
    seq: ++seq,
    ts: Date.now(),
    user: {
      userId: id,
      secUid: raw.secUid || raw.user?.secUid || null,
      uniqueId: raw.uniqueId || raw.user?.uniqueId || null,
      nickname: name,
      profilePictureUrl: avatar,
    },
    userId: id,
    displayName: name,
    profilePictureUrl: avatar,
    text,
  };

  pushBuffer(obj);
  broadcast(obj);
});

// --- LIKES ---
conn.on('like', raw => {
  const u = normUser(raw);
  emit({
    type: 'like',
    ts: Date.now(),
    userId: u.userId,
    user: u,
    displayName: u.nickname,
    profilePictureUrl: u.profilePictureUrl,
    likeCount: Number(raw.likeCount || 1),
    totalLikeCount: Number(raw.totalLikeCount || 0)
  });
});

// --- GIFTS ---
conn.on('gift', raw => {
  const u = normUser(raw);
  const g = raw.gift || {};
  emit({
    type: 'gift',
    ts: Date.now(),
    userId: u.userId,
    user: u,
    displayName: u.nickname,
    profilePictureUrl: u.profilePictureUrl,
    giftId: Number(g.giftId || raw.giftId || 0),
    giftName: g.giftName || raw.giftName || '',
    giftPictureUrl: g.giftPictureUrl || raw.giftPictureUrl || '',
    diamondCount: Number(g.diamondCount || raw.diamondCount || 0),
    count: Number(raw.repeatCount || g.repeatCount || 1),
    isComboEnd: !!(raw.repeatEnd || g.repeatEnd)
  });
});

// --- FOLLOWS ---
conn.on('follow', raw => {
  const u = normUser(raw);
  emit({ type: 'follow', ts: Date.now(), userId: u.userId, user: u, displayName: u.nickname });
});

// --- SHARES ---
conn.on('share', raw => {
  const u = normUser(raw);
  emit({ type: 'share', ts: Date.now(), userId: u.userId, user: u, displayName: u.nickname });
});

// --- JOINS & VIEWERS ---
conn.on('member', raw => {
  const u = normUser(raw);
  emit({ type: 'join', ts: Date.now(), userId: u.userId, user: u, displayName: u.nickname });
});
conn.on('roomUser', raw => {
  emit({ type: 'roomUser', ts: Date.now(), viewerCount: Number(raw.viewerCount || 0) });
});

// --- STREAM LIFECYCLE ---
conn.on('connected', (s) => console.log('[tt] connected room', s?.roomId));
conn.on('disconnected', (r) => { console.log('[tt] disconnected', r); emit({ type:'disconnected', ts:Date.now(), reason: r || null }); });
conn.on('streamEnd', () => emit({ type:'streamEnd', ts: Date.now() }));
conn.on('error', (e) => console.log('[tt] error', e?.info || e?.message || e));

(async () => {
  try {
    await conn.connect();
  } catch (e) {
    console.error('[tt] connect failed:', e?.message || e);
    console.error('Handle must be LIVE. USER =', USER);
  }
})();

server.listen(PORT, () =>
  console.log(`relay up http://localhost:${PORT}  ws path /stream  user=${USER}`)
);

// --- helpers ---
function safeConfigUser() {
  try {
    const cfg = require('./config.json');
    return String(cfg?.username || '');
  } catch {
    return '';
  }
}
