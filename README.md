# Hermes Web

A self-hosted, dragonfly.xyz-inspired web interface for the local **Hermes
agent**. Dark, minimal, numbered sections (01 Chat · 02 Sessions · 03 Jobs ·
04 Status).

**No WebSockets.** Streaming uses Server-Sent Events (plain HTTP) read with
`fetch` + `ReadableStream`. A thin FastAPI proxy holds the API key server-side
and forwards REST + SSE to the Hermes API server.

```
Browser (vanilla JS)  →  hermes-web proxy (FastAPI :8080)  →  Hermes API (:8642)
```

## Prerequisites: enable the Hermes API server

The proxy talks to the Hermes aiohttp API server, which runs inside the
`hermes-gateway` service. Enable it once in `~/.hermes/.env`:

```
API_SERVER_ENABLED=true
API_SERVER_KEY=<a strong random token>     # python3 -c "import secrets; print(secrets.token_urlsafe(32))"
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8642
```

Then restart the gateway:

```
systemctl --user restart hermes-gateway
```

Verify: `curl -s 127.0.0.1:8642/health/detailed`

## Run

```
cd ~/hermes-web
./venv/bin/python server.py
```

It binds to `0.0.0.0:8080` by default, so reach it from any device on your LAN
at `http://<pi-ip>:8080` (the startup line prints the exact URL). Set
`HERMES_WEB_HOST=127.0.0.1` if you want to restrict it to the Pi itself.

(Deps are already installed in `./venv`. To recreate:
`python3 -m venv venv && ./venv/bin/pip install -r requirements.txt`.)

The proxy reads `API_SERVER_KEY` from `~/.hermes/.env` automatically. Override
anything via environment variables — see `.env.example`.

## Run as a service (optional)

Create `~/.config/systemd/user/hermes-web.service`:

```
[Unit]
Description=Hermes Web UI
After=hermes-gateway.service

[Service]
ExecStart=%h/hermes-web/venv/bin/python %h/hermes-web/server.py
Restart=on-failure

[Install]
WantedBy=default.target
```

Then: `systemctl --user enable --now hermes-web`

## Layout

```
server.py            FastAPI proxy + static host
static/index.html    single-page shell
static/css/app.css   design system
model_admin.py       model list/switch helper, run with HERMES's venv python
static/js/
  bg.js              animated flow-field background
  md.js              tiny markdown renderer
  api.js             fetch client + SSE stream parser + UI helpers
  chat.js            streaming chat + slash-command handling
  modelpicker.js     model selector (header)
  sessions.js        session management (left pane)
  jobs.js            cron jobs (right pane)
  status.js          health / models / skills / toolsets (right pane)
  router.js          bootstrap (init panes) + gateway liveness poll
```

## Model picker & slash commands

The header model button lists models you're authenticated for and switches the
**global** Hermes model (`~/.hermes/config.yaml`) — so it affects Telegram/etc.
too, not just the web UI. It works by running `model_admin.py` with Hermes' own
venv python (Hermes' files are never modified). The running gateway picks up the
change on the next chat (config is mtime-cached — no restart needed).

The chat box accepts a web-supported subset of slash commands: `/new`, `/model
[name]`, `/fork`, `/rename <title>`, `/skills`, `/help`. Arbitrary Hermes slash
commands (e.g. `/compress`, `/memory`) aren't exposed by the API server.

## Security notes

- Binds to `0.0.0.0` so it's reachable on your LAN — anyone on the same network
  can open the UI and talk to the agent. Fine for a trusted home network; if that
  isn't your situation, set `HERMES_WEB_HOST=127.0.0.1` or front it with a reverse
  proxy that adds TLS + auth.
- The API key never reaches the browser (held by the proxy, read from `~/.hermes/.env`).
- `.env` and `venv/` are gitignored.
