"""Headless model list/switch helper for Hermes Web.

Runs with the HERMES venv python (so it can import hermes_cli) but lives in the
hermes-web project — Hermes' own files are left untouched. The proxy shells out
to this for the web model picker.

Usage:
    <hermes-venv>/bin/python model_admin.py list
    <hermes-venv>/bin/python model_admin.py set <model> [provider]

Prints a single JSON object to stdout.
"""
import json
import sys


def _load_cfg():
    from hermes_cli.config import read_raw_config
    return read_raw_config() or {}


def _current(cfg):
    mc = cfg.get("model", {})
    if isinstance(mc, str):
        return {"model": mc, "provider": ""}
    if isinstance(mc, dict):
        return {"model": mc.get("default") or mc.get("model") or "", "provider": mc.get("provider", "")}
    return {"model": "", "provider": ""}


def _label(slug):
    try:
        from hermes_cli.providers import get_label
        return get_label(slug) or slug
    except Exception:
        return slug


def cmd_list():
    cfg = _load_cfg()
    cur = _current(cfg)
    providers = []
    try:
        from hermes_cli.model_switch import list_picker_providers
        rows = list_picker_providers(
            current_provider=cur["provider"],
            user_providers=cfg.get("providers"),
            custom_providers=cfg.get("custom_providers"),
            max_models=60,
            current_model=cur["model"],
        )
        for p in rows:
            slug = p.get("slug", "")
            providers.append({
                "slug": slug,
                "label": p.get("label") or _label(slug),
                "models": [str(m) for m in (p.get("models") or [])][:60],
            })
    except Exception as e:  # listing is best-effort
        return {"current": cur, "providers": [], "error": str(e)}
    return {"current": cur, "providers": providers}


def cmd_set(model, provider):
    cfg = _load_cfg()
    cur = _current(cfg)
    from hermes_cli.model_switch import switch_model
    res = switch_model(
        model,
        current_provider=cur["provider"],
        current_model=cur["model"],
        is_global=True,
        explicit_provider=provider or "",
        user_providers=cfg.get("providers"),
        custom_providers=cfg.get("custom_providers"),
    )
    if not getattr(res, "success", False):
        return {"ok": False, "error": getattr(res, "error_message", "switch failed") or "switch failed"}

    # Persist to config.yaml exactly as the gateway's /model --global does.
    from hermes_cli.config import save_config
    raw = _load_cfg()
    rm = raw.get("model")
    if isinstance(rm, dict):
        mc = rm
    elif isinstance(rm, str) and rm.strip():
        mc = {"default": rm.strip()}
        raw["model"] = mc
    else:
        mc = {}
        raw["model"] = mc
    mc["default"] = res.new_model
    mc["provider"] = res.target_provider
    if getattr(res, "base_url", ""):
        mc["base_url"] = res.base_url
    save_config(raw)
    return {"ok": True, "model": res.new_model, "provider": res.target_provider,
            "provider_label": _label(res.target_provider)}


def main():
    args = sys.argv[1:]
    if not args:
        print(json.dumps({"error": "no command"})); return
    try:
        if args[0] == "list":
            out = cmd_list()
        elif args[0] == "set" and len(args) >= 2:
            out = cmd_set(args[1], args[2] if len(args) > 2 else "")
        else:
            out = {"error": "usage: list | set <model> [provider]"}
    except Exception as e:
        out = {"error": str(e)}
    print(json.dumps(out))


if __name__ == "__main__":
    main()
