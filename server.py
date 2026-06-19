"""Hermes Web — a thin self-hosted proxy + static host for the Hermes agent.

Serves the dark, dragonfly-inspired UI from ./static and proxies REST + SSE
requests to the local Hermes API server (aiohttp @ 127.0.0.1:8642), injecting
the Bearer API key server-side so it never reaches the browser. No WebSockets:
streaming uses Server-Sent Events (text/event-stream) passed straight through.
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from dotenv import dotenv_values
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

# --- Configuration -------------------------------------------------------

HERMES_ENV_FILE = os.getenv("HERMES_ENV_FILE", str(Path.home() / ".hermes" / ".env"))


def _load_api_key() -> str:
    """Resolve the Hermes API key: explicit env wins, else read ~/.hermes/.env."""
    key = os.getenv("HERMES_API_KEY")
    if key:
        return key.strip()
    values = dotenv_values(HERMES_ENV_FILE)
    return (values.get("API_SERVER_KEY") or "").strip()


HERMES_API_BASE = os.getenv("HERMES_API_BASE", "http://127.0.0.1:8642").rstrip("/")
HERMES_API_KEY = _load_api_key()
HERMES_WEB_HOST = os.getenv("HERMES_WEB_HOST", "0.0.0.0")
HERMES_WEB_PORT = int(os.getenv("HERMES_WEB_PORT", "8080"))

# Hermes home + venv python, used to run model_admin.py (model list/switch)
# with Hermes' own code without modifying any Hermes files.
HERMES_HOME_DIR = os.getenv("HERMES_HOME_DIR", str(Path.home() / ".hermes" / "hermes-agent"))
HERMES_VENV_PY = os.getenv(
    "HERMES_VENV_PY", str(Path(HERMES_HOME_DIR) / "venv" / "bin" / "python"))
MODEL_ADMIN = str(BASE_DIR / "model_admin.py")

# Headers we must not copy from the browser to Hermes.
# - hop-by-hop / framing headers (host, content-length, connection)
# - authorization: the proxy sets its own Bearer key
# - origin / referer: Hermes' CORS middleware 403s any browser Origin that
#   isn't in its allowlist. Stripping them makes the server->Hermes hop look
#   like a trusted local client (the browser->proxy hop is same-origin anyway).
_DROP_REQUEST_HEADERS = {
    "host", "content-length", "connection", "authorization", "origin", "referer",
}
_DROP_RESPONSE_HEADERS = {
    "content-length",
    "content-encoding",
    "transfer-encoding",
    "connection",
}

# A long-lived client; no read timeout so SSE streams stay open.
_client = httpx.AsyncClient(
    base_url=HERMES_API_BASE,
    timeout=httpx.Timeout(connect=10.0, read=None, write=30.0, pool=10.0),
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await _client.aclose()


app = FastAPI(title="Hermes Web", docs_url=None, redoc_url=None,
              openapi_url=None, lifespan=lifespan)


def _upstream_headers(request: Request) -> dict[str, str]:
    headers = {
        k: v for k, v in request.headers.items() if k.lower() not in _DROP_REQUEST_HEADERS
    }
    if HERMES_API_KEY:
        headers["Authorization"] = f"Bearer {HERMES_API_KEY}"
    return headers


async def _proxy(path: str, request: Request):
    if not HERMES_API_KEY:
        return JSONResponse(
            {"error": "Hermes API key not configured. Set API_SERVER_KEY in "
                      f"{HERMES_ENV_FILE} or HERMES_API_KEY in the environment."},
            status_code=503,
        )

    body = await request.body()
    upstream = _client.build_request(
        request.method,
        path,
        params=request.query_params,
        headers=_upstream_headers(request),
        content=body if body else None,
    )

    try:
        resp = await _client.send(upstream, stream=True)
    except httpx.ConnectError:
        return JSONResponse(
            {"error": "Cannot reach Hermes API server. Is hermes-gateway running "
                      "with the API server enabled?"},
            status_code=502,
        )

    out_headers = {
        k: v for k, v in resp.headers.items() if k.lower() not in _DROP_RESPONSE_HEADERS
    }
    content_type = resp.headers.get("content-type", "")

    # Stream SSE (and any chunked stream) straight through, unbuffered.
    if content_type.startswith("text/event-stream"):
        out_headers.setdefault("Cache-Control", "no-cache")
        out_headers["X-Accel-Buffering"] = "no"

        async def event_stream():
            try:
                async for chunk in resp.aiter_raw():
                    yield chunk
            finally:
                await resp.aclose()

        return StreamingResponse(
            event_stream(),
            status_code=resp.status_code,
            headers=out_headers,
            media_type="text/event-stream",
        )

    # Buffered response for ordinary JSON.
    data = await resp.aread()
    await resp.aclose()
    return Response(content=data, status_code=resp.status_code, headers=out_headers,
                    media_type=content_type or None)


_PROXY_METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"]


@app.api_route("/api/{rest:path}", methods=_PROXY_METHODS)
async def proxy_api(rest: str, request: Request):
    return await _proxy("/api/" + rest, request)


@app.api_route("/v1/{rest:path}", methods=_PROXY_METHODS)
async def proxy_v1(rest: str, request: Request):
    return await _proxy("/v1/" + rest, request)


@app.api_route("/health", methods=["GET"])
@app.api_route("/health/{rest:path}", methods=["GET"])
async def proxy_health(request: Request, rest: str = ""):
    return await _proxy("/health" + (f"/{rest}" if rest else ""), request)


# --- Model picker (local; not forwarded to Hermes) -----------------------
# Switches the GLOBAL model in ~/.hermes/config.yaml via Hermes' own code.
# Affects all platforms (Telegram etc.), not just the web UI.

async def _run_model_admin(*args: str) -> JSONResponse:
    import asyncio
    import json
    if not Path(HERMES_VENV_PY).exists():
        return JSONResponse({"error": f"Hermes venv python not found at {HERMES_VENV_PY}"}, status_code=503)
    try:
        proc = await asyncio.create_subprocess_exec(
            HERMES_VENV_PY, MODEL_ADMIN, *args,
            cwd=HERMES_HOME_DIR,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        out, err = await asyncio.wait_for(proc.communicate(), timeout=60)
    except asyncio.TimeoutError:
        return JSONResponse({"error": "model helper timed out"}, status_code=504)
    if proc.returncode != 0 and not out.strip():
        return JSONResponse({"error": (err or b"").decode("utf-8", "replace")[:500] or "helper failed"}, status_code=500)
    try:
        data = json.loads(out.decode("utf-8"))
    except Exception:
        return JSONResponse({"error": "bad helper output", "raw": out.decode("utf-8", "replace")[:300]}, status_code=500)
    status = 400 if (isinstance(data, dict) and (data.get("error") or data.get("ok") is False)) else 200
    return JSONResponse(data, status_code=status)


@app.get("/app/models")
async def app_models():
    return await _run_model_admin("list")


@app.post("/app/model")
async def app_set_model(request: Request):
    body = await request.json()
    model = (body.get("model") or "").strip()
    provider = (body.get("provider") or "").strip()
    if not model:
        return JSONResponse({"error": "model is required"}, status_code=400)
    return await _run_model_admin("set", model, provider)


# Static assets (index.html served at "/"). Mounted last so /api,/v1 win.
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    print(f"Hermes Web → proxying to {HERMES_API_BASE} "
          f"(key {'loaded' if HERMES_API_KEY else 'MISSING'})")
    if HERMES_WEB_HOST in ("0.0.0.0", "::"):
        import socket
        lan = "<this-host-ip>"
        # Pick the IP used to reach the LAN (no packets actually sent).
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("10.255.255.255", 1))
            lan = s.getsockname()[0]
        except OSError:
            pass
        finally:
            s.close()
        print(f"Serving on all interfaces:{HERMES_WEB_PORT}  →  "
              f"reach it at http://{lan}:{HERMES_WEB_PORT}")
    else:
        print(f"Serving on http://{HERMES_WEB_HOST}:{HERMES_WEB_PORT}")
    uvicorn.run(app, host=HERMES_WEB_HOST, port=HERMES_WEB_PORT, log_level="info")
