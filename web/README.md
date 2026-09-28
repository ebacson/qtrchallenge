# QTR echiptime — Web

Web client for the Firebase project `echiptime` (same RTDB as iOS/Android).

## Phase 1

- Email auth, Home, Challenges (join/leave), Activities (read), Profile

## Phase 2 — Strava (aligned with Strava Developer Program 2026–2027)

Direct integration only — **no intermediary platforms**.

| Requirement | Web implementation |
|-------------|-------------------|
| Token exchange / refresh with `client_secret` | Server routes under `/api/strava/*` (Vite middleware). Secret **never** in the browser or written to Firebase user nodes. |
| API host | `https://www.api-v3.strava.com` (not legacy `www.strava.com/api/v3`) |
| Access token placement | `Authorization: Bearer …` header |
| Revoke | Prefers `POST /oauth/revoke`; falls back to `oauth/deauthorize` until Strava retires it (2027-06-01) |
| Club endpoints | Not used (deprecated 2026-09-01) |
| Standard Tier subscription | Required for new Standard Tier apps from **2026-06-01**, existing by **2026-06-30**. Extended Access unaffected. Active Standard Tier apps without a sub can redeem 3 months free via Strava’s email link (code `5464f4e5b6`). |

After sync, challenge progress is recalculated for joined ongoing/upcoming challenges (same rules as iOS).

### Strava setup

1. Open [Strava API settings](https://www.strava.com/settings/api)
2. Set **Authorization Callback Domain** to `localhost` (dev) or your production host
3. Put credentials in `.env.local` (see `.env.example`):

```bash
STRAVA_CLIENT_ID=…
STRAVA_CLIENT_SECRET=…
STRAVA_REDIRECT_URI=http://localhost:5173/strava/callback
```

4. Restart `npm run dev`, open **Strava** tab → Connect → Sync

> Production static hosting must still expose the same `/api/strava/*` endpoints (keep the Vite plugin for `preview`, or port `server/strava.ts` to Cloud Functions / your Node host).

## GitHub Pages

Live (after Actions deploy): https://quangtrirunners.online/

Static hosting only — **Strava OAuth/sync API** (`/api/strava/*`) needs local `npm run dev` or a separate backend. Auth + Challenges + Activities read from Firebase still work on Pages.

## Run

```bash
cd web
cp .env.example .env.local   # fill Strava + Firebase
npm install
npm run dev
```

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite + Strava API middleware |
| `npm run build` | Typecheck + production build |
| `npm run preview` | Preview + same Strava middleware |
