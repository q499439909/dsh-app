#!/usr/bin/env bash
set -euo pipefail

DSH_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DJ_ROOT="${DJ_ROOT:-$(cd -- "$DSH_ROOT/.." && pwd)/data-juicer}"
DJ_PYTHON="${DJ_PYTHON:-$DJ_ROOT/.venv/bin/python}"
DSH_PORT="${DSH_PORT:-57035}"
DJ_MCP_PORT="${DJ_MCP_PORT:-8010}"
DJ_EXECUTION_MODE="${DJ_EXECUTION_MODE:-native}"
DSH_HOST="${DSH_HOST:-127.0.0.1}"

DSH_BIN="$DSH_ROOT/node_modules/@deepseek-ai/dsh/lib/bin.js"
PATCH_TEMPLATE="$DSH_ROOT/dj-dsh.patch.yml"
PATCH_FILE="$DSH_ROOT/.dsh/dj-dsh.linux.patch.yml"
MCP_ENV_FILE="$DSH_ROOT/dj-plan-flow.env"
AUTH_ENV_FILE="$DSH_ROOT/dsh-auth.env"
INTERNAL_TOKEN_PATH="$DSH_ROOT/.dsh/dj-internal-token"
MCP_TEMP_DIR="$DJ_ROOT/.mcp-tmp"
PROFILE_MODULE_ROOT="${DSH_PROFILE_ROOT:-$HOME/.dsh/profiles/web}/node_modules/@dsh-dj"

case "$DJ_EXECUTION_MODE" in
  native|broker) ;;
  *) echo "DJ_EXECUTION_MODE must be native or broker" >&2; exit 2 ;;
esac
if [[ "$DSH_HOST" != "127.0.0.1" ]]; then
  echo "DSH only supports DSH_HOST=127.0.0.1 because it exposes code-execution capabilities." >&2
  echo "Keep it on loopback and use an SSH tunnel or the platform's authenticated port forwarding." >&2
  exit 2
fi

for path in "$DSH_BIN" "$DJ_PYTHON" "$PATCH_TEMPLATE"; do
  if [[ ! -f "$path" ]]; then
    echo "Required file not found: $path" >&2
    exit 1
  fi
done

link_plugin() {
  local name="$1"
  local source="$2"
  local link="$PROFILE_MODULE_ROOT/$name"

  if [[ ! -d "$source" ]]; then
    echo "Plugin source not found: $source" >&2
    exit 1
  fi
  mkdir -p "$(dirname -- "$link")"
  if [[ -L "$link" ]]; then
    if [[ "$(readlink -f -- "$link")" != "$(readlink -f -- "$source")" ]]; then
      echo "A different plugin symlink already exists: $link" >&2
      exit 1
    fi
  elif [[ -e "$link" ]]; then
    echo "A non-symlink plugin entry already exists: $link" >&2
    exit 1
  else
    ln -s "$source" "$link"
  fi
}

read_env_value() {
  local file="$1"
  local name="$2"
  local line value

  [[ -f "$file" ]] || return 1
  line="$(grep -E "^[[:space:]]*${name}=" "$file" | tail -n 1 || true)"
  [[ -n "$line" ]] || return 1
  value="${line#*=}"
  value="${value%$'\r'}"
  if [[ ${#value} -ge 2 ]]; then
    if [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]] ||
       [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
      value="${value:1:${#value}-2}"
    fi
  fi
  printf -v "$name" '%s' "$value"
  export "$name"
}

port_is_open() {
  "$DJ_PYTHON" - "$1" <<'PY' >/dev/null 2>&1
import socket
import sys

with socket.socket() as sock:
    sock.settimeout(0.2)
    raise SystemExit(sock.connect_ex(("127.0.0.1", int(sys.argv[1]))) != 0)
PY
}

link_plugin operator-library "$DSH_ROOT/packages/dsh-dj-operator-library"
link_plugin plan-explorer "$DSH_ROOT/packages/dsh-dj-plan-explorer"
link_plugin user-auth "$DSH_ROOT/packages/dsh-user-auth"
link_plugin datasets "$DSH_ROOT/packages/dsh-dj-datasets"

mkdir -p "$DSH_ROOT/.dsh" "$MCP_TEMP_DIR"
umask 077
if [[ ! -s "$INTERNAL_TOKEN_PATH" ]]; then
  "$DJ_PYTHON" - "$INTERNAL_TOKEN_PATH" <<'PY'
from pathlib import Path
import secrets
import sys

Path(sys.argv[1]).write_text(secrets.token_urlsafe(32), encoding="utf-8")
PY
fi
DSH_DJ_INTERNAL_TOKEN="$(tr -d '\r\n' < "$INTERNAL_TOKEN_PATH")"
export DSH_DJ_INTERNAL_TOKEN

if ! read_env_value "$AUTH_ENV_FILE" DSH_REGISTRATION_INVITE_HASH; then
  echo "Missing DSH_REGISTRATION_INVITE_HASH in $AUTH_ENV_FILE" >&2
  exit 1
fi
read_env_value "$AUTH_ENV_FILE" DSH_AUTH_DATABASE_PATH ||
  export DSH_AUTH_DATABASE_PATH="$DSH_ROOT/.dsh/auth.sqlite"
read_env_value "$AUTH_ENV_FILE" DSH_AUTH_SECURE_COOKIE ||
  export DSH_AUTH_SECURE_COOKIE=false

for name in OPENAI_API_KEY DASHSCOPE_API_KEY SK OPENAI_BASE_URL OPENAI_API_URL \
  DASHSCOPE_BASE_URL DJ_VLM_MODEL DASHSCOPE_DEFAULT_MODEL OPENAI_DEFAULT_MODEL; do
  read_env_value "$MCP_ENV_FILE" "$name" || true
done

# The checked-in patch retains the Windows development path. Generate a local
# Linux copy without changing the source file or depending on a fixed clone path.
node - "$PATCH_TEMPLATE" "$PATCH_FILE" "$DSH_ROOT/.dsh/skills" <<'NODE'
const fs = require("node:fs");
const [source, target, skillDir] = process.argv.slice(2);
const patch = fs.readFileSync(source, "utf8")
  .replace("D:\\dsh-app\\.dsh\\skills", skillDir);
fs.writeFileSync(target, patch);
NODE

mcp_pid=""
cleanup() {
  if [[ -n "$mcp_pid" ]] && kill -0 "$mcp_pid" 2>/dev/null; then
    kill "$mcp_pid" 2>/dev/null || true
    wait "$mcp_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if port_is_open "$DJ_MCP_PORT"; then
  echo "Using the MCP already listening on 127.0.0.1:$DJ_MCP_PORT"
  echo "Restart it after changing Python code or dj-plan-flow.env."
else
  echo "Starting Data-Juicer plan-flow MCP on 127.0.0.1:$DJ_MCP_PORT"
  (
    cd "$DJ_ROOT"
    export TEMP="$MCP_TEMP_DIR" TMP="$MCP_TEMP_DIR" TMPDIR="$MCP_TEMP_DIR"
    export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
    export DJ_PLAN_FLOW_CONFIG_FILE="$MCP_ENV_FILE"
    export DJ_PLAN_FLOW_EXECUTION_MODE
    exec "$DJ_PYTHON" -m data_juicer.tools.mcp_server plan-flow \
      --transport streamable-http --port "$DJ_MCP_PORT"
  ) &
  mcp_pid=$!

  for _ in $(seq 1 40); do
    port_is_open "$DJ_MCP_PORT" && break
    kill -0 "$mcp_pid" 2>/dev/null || {
      wait "$mcp_pid"
      exit 1
    }
    sleep 0.25
  done
  if ! port_is_open "$DJ_MCP_PORT"; then
    echo "Data-Juicer MCP did not become ready on port $DJ_MCP_PORT" >&2
    exit 1
  fi
fi

echo "Starting DSH at http://127.0.0.1:$DSH_PORT/ (bind: $DSH_HOST)"
cd "$DSH_ROOT"
set +e
node "$DSH_BIN" web --patch "$PATCH_FILE" --host "$DSH_HOST" \
  --port "$DSH_PORT" --no-open "$@"
status=$?
set -e
exit "$status"
