# 🎛️ Voice Tuner

Dial in your **writing voice** on a mixing-console interface — then let it steer
your (or your AI writer's) output. Feed in samples of how you write and **Claude
sets the levels for you**; keep multiple named styles (Professional, Personal, …);
and share any style as a read-only **Voice Card**.

A **Gonemo** project — [www.gonemo.ai](https://www.gonemo.ai).

Powered by **Claude (`claude-opus-4-8`)** via the Anthropic API, with an offline
demo mode so it runs with no key.

---

## What it does

- **Auto-tune from your writing.** Paste text, upload documents (`.pdf`, `.docx`,
  `.txt`, `.md`, `.html`), or add URLs of things you've written. The analyzer
  reads them and sets the four faders, picks identity words, and suggests
  mutes/solos. With an API key this is Claude; without one, a local heuristic
  does a best-effort pass.
- **The mixing console.** Four faders (Technical Depth · Wit · Formality · Pace),
  *Mute* toggles (things the voice never does), *Solo* toggles (what it's known
  for), and *Routing* chips (where it's used).
- **Multiple styles per account.** Keep a "Professional" and a "Personal" voice
  side by side — each saved independently, auto-saved as you tune.
- **Voice Card _or_ Style Guide.** Toggle between a compact printed-looking card
  and a fuller written style guide (Core identity · Who you're writing for ·
  Non-negotiables · What you're known for · Where this shows up · Structural
  patterns). Copy either as text or download as Markdown to hand to an AI agent.
- **Shareable links.** Turn on sharing for a style to get a public, read-only
  `/s/…` link — no account needed to view it (with the same card/guide toggle).
- **Password reset.** "Forgot password?" emails a single-use, 1-hour reset link.

---

## Quick start

Requires Node.js 20.12+ (developed on Node 22).

```bash
npm install
npm start          # → http://localhost:4344
```

With no API key the app runs in **offline demo mode** — the analyzer uses local
heuristics, so you can click through the whole flow immediately.

To use **real Claude analysis**, add your Anthropic API key:

```bash
cp .env.example .env
#   set ANTHROPIC_API_KEY=sk-ant-...   (or export it)
npm start
```

`npm run dev` runs with auto-reload. `npm run typecheck` type-checks without running.

A pill in the top bar shows which backend is active (**Live · Claude** or **Demo**).

---

## How it works

```
public/                 Single-page front end (vanilla HTML/CSS/JS, no build step)
src/
  server.ts             Express server + REST API (auth-gated)
  auth.ts               Accounts (email+password), scrypt hashing, signed sessions,
                        password-reset tokens
  email.ts              Reset-email delivery (SMTP / Resend / console fallback)
  store.ts              File-backed users + styles + reset tokens (data/)
  ingest.ts             Turn samples (paste/upload/URL, incl. pdf & docx) into text
  provider.ts           Pick the analysis backend (live Claude vs offline)
  anthropic.ts          Live Claude analysis (forced tool call → structured JSON)
  demo.ts               Offline heuristic analyzer (no key needed)
  config.ts             The console vocabulary (adjectives/faders/mutes/solos/routes)
  types.ts / env.ts     Shared types + environment config
data/                   Runtime state (gitignored): users.json + per-user styles
```

### API

**Auth**

| Method & path | Purpose |
| --- | --- |
| `POST /api/auth/signup` | Create an account. Body: `{ email, password }` |
| `POST /api/auth/login` | Sign in |
| `POST /api/auth/logout` | Sign out |
| `GET  /api/auth/me` | Current user, or 401 |
| `POST /api/auth/forgot` | Email a reset link. Body: `{ email }`. Always `{ ok: true }` |
| `POST /api/auth/reset` | Set a new password + sign in. Body: `{ token, password }` |

**Styles** (require a session)

| Method & path | Purpose |
| --- | --- |
| `GET  /api/styles` | List the user's styles |
| `POST /api/styles` | Create a style. Body: `{ name }` |
| `GET  /api/styles/:id` | One style |
| `PUT  /api/styles/:id` | Save name/console state |
| `DELETE /api/styles/:id` | Delete a style |
| `POST /api/styles/:id/analyze` | Analyze samples → console settings. Body: `{ samples: [...] }` |
| `POST /api/styles/:id/share` | Toggle a public link. Body: `{ enabled }` |
| `GET  /api/share/:shareId` | Public read-only style (no auth) |

### Config

| Env var | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | Enables live Claude analysis; unset → demo mode |
| `PROVIDER` | auto | Force `live` or `demo` |
| `MODEL` | `claude-opus-4-8` | Override the model |
| `PORT` | `4344` | Server port |
| `ALLOWED_EMAIL_DOMAIN` | — | Restrict sign-ups to one domain |
| `SESSION_SECRET` | generated | Stable cookie-signing secret for production |
| `SECURE_COOKIES` | — | Set `1` behind HTTPS |
| `DATA_DIR` | `./data` | Where users + styles are stored |
| `SMTP_*` / `RESEND_API_KEY` | — | Reset-email backend (else links are logged) |
| `RESET_EMAIL_FROM` | Gonemo sender | Visible sender for reset emails |
| `APP_URL` | derived | Base URL for reset links (behind a proxy) |

### Deploy (Render)

This repo includes a `render.yaml` Blueprint. On [render.com](https://render.com):
**New → Blueprint**, pick this repo, and Render creates the web service.
`SESSION_SECRET` is generated and pinned, `SECURE_COOKIES=1` is preset; add
`ANTHROPIC_API_KEY` in the dashboard to enable live Claude. Free-plan disk is
**ephemeral** (accounts reset on redeploy) — attach a persistent disk and set
`DATA_DIR` for durable storage (see the commented block in `render.yaml`).

### Notes

- **Live analysis** uses a forced `report_voice` tool call so responses are
  always structured; on any failure it falls back to the offline heuristic.
- **Uploaded files:** `.pdf` and `.docx` are parsed server-side (pdf-parse +
  mammoth); text files are read in the browser. Legacy `.doc` isn't supported —
  save as `.docx` or paste the text.
- **Reset tokens** are stored only as SHA-256 hashes, single-use, 1-hour expiry.
- All dynamic content in the Voice Card / Style Guide is HTML-escaped.
