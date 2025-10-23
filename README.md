# KQuiz Relay

This project powers the Kostelio klausimynas (KQuiz) game. It connects to TikTok LIVE through [`tiktok-live-connector`](https://github.com/zerodytrash/TikTok-Live-Connector) and exposes a lightweight WebSocket feed that the browser client consumes.

## What’s included
- `/stream` – plain WebSocket relay that forwards chat, likes, gifts, follows, joins, viewer counts, disconnects, and stream end events.
- `/img?u=` – simple avatar proxy that keeps the browser from making cross-origin requests.
- Static hosting for the KQuiz interface under `public/kquiz` plus helper tools such as `public/quiz.html`.
- Centralised media in `public/kquiz/assets/` (`audio/` + `images/`) so the core app and add-ons share the same sounds and artwork.

## Getting started
1. Install dependencies with `npm install`.
2. Provide the TikTok username either by setting `TT_USERNAME` (recommended) or editing `config.json`:
   ```json
   {
     "username": "your-tiktok-handle"
   }
   ```
3. Start the relay with `npm start` (listens on port `8091` by default).
4. Visit http://localhost:8091/ to load the KQuiz UI (served from `public/kquiz`). The WebSocket endpoint is available at `ws://localhost:8091/stream`.

## Health check
`GET /health` returns `{ ok: true, user: "<username>" }` so you can verify the process is alive and pointing at the expected TikTok account.
