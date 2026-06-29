#!/usr/bin/env bash
set -euo pipefail

AUTH_FILE="${1:-$HOME/.codex/auth.json}"
API_URL="https://chatgpt.com/backend-api/wham/rate-limit-reset-credits"

if [ ! -f "$AUTH_FILE" ]; then
  echo "錯誤：找不到 auth.json：$AUTH_FILE" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "錯誤：系統未安裝 python3，無法解析 JSON。" >&2
  exit 1
fi

python3 - "$AUTH_FILE" "$API_URL" <<'PY'
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def parse_time(value: Any) -> str:
    if not value:
        return "N/A"
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        try:
            dt = datetime.strptime(str(value), "%Y-%m-%dT%H:%M:%S.%fZ")
            dt = dt.replace(tzinfo=timezone.utc)
        except Exception:
            return str(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone().strftime("%Y-%m-%d %H:%M:%S %z")


auth_path = Path(sys.argv[1])
url = sys.argv[2]

with auth_path.open("r", encoding="utf-8") as f:
    auth = json.load(f)

tokens = auth.get("tokens", {}) if isinstance(auth, dict) else {}
access_token = (tokens or {}).get("access_token") if isinstance(tokens, dict) else None
account_id = (tokens or {}).get("account_id") if isinstance(tokens, dict) else None

if not access_token:
    raise SystemExit("錯誤：auth.json 內未找到 tokens.access_token")

req = urllib.request.Request(url)
req.add_header("Authorization", f"Bearer {access_token}")
req.add_header("OpenAI-Beta", "codex-1")
req.add_header("originator", "Codex Desktop")
if account_id:
    req.add_header("ChatGPT-Account-ID", str(account_id))

try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode("utf-8")
except Exception as exc:
    raise SystemExit(f"錯誤：請求 API 失敗：{exc}")

result = json.loads(body)
if not isinstance(result, dict):
    raise SystemExit("錯誤：API 回傳格式非預期")

available_count = result.get("available_count", "N/A")
print(f"available_count: {available_count}")

credits = result.get("credits") or result.get("items") or result.get("data") or []
if not isinstance(credits, list):
    credits = []

if not credits:
    print("credits: 0")
    raise SystemExit(0)

print("credits:")
for idx, credit in enumerate(credits, 1):
    if not isinstance(credit, dict):
        continue
    granted_at = parse_time(credit.get("granted_at"))
    expires_at = parse_time(credit.get("expires_at"))
    status = credit.get("status", "N/A")
    print(f"- credit #{idx}")
    print(f"  granted_at: {granted_at}")
    print(f"  expires_at: {expires_at}")
    print(f"  status: {status}")
PY
