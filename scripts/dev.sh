#!/usr/bin/env bash
# Build the client, start the server, and expose it through ngrok so phones on
# any network can reach it.
#
#   ./scripts/dev.sh              build + serve + tunnel
#   ./scripts/dev.sh --local      no tunnel (same-wifi or desktop testing)
#   ./scripts/dev.sh --no-build   skip the client build
set -euo pipefail

cd "$(dirname "$0")/.."
PORT="${PORT:-8000}"
TUNNEL=1
BUILD=1
for arg in "$@"; do
  case "$arg" in
    --local) TUNNEL=0 ;;
    --no-build) BUILD=0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ "$BUILD" = 1 ]; then
  if [ ! -d client/node_modules ]; then
    echo "==> installing client dependencies"
    (cd client && npm install --no-audit --no-fund)
  fi
  echo "==> building client"
  (cd client && npm run build)
fi

cleanup() { jobs -p | xargs -r kill 2>/dev/null || true; }
trap cleanup EXIT

echo "==> serving on http://0.0.0.0:${PORT}"
python3 -m uvicorn server.app:app --host 0.0.0.0 --port "$PORT" &

if [ "$TUNNEL" = 1 ]; then
  if ! command -v ngrok >/dev/null 2>&1; then
    cat >&2 <<'MSG'

ngrok is not installed. Either:
  * install it (https://ngrok.com/download) and add your authtoken, or
  * re-run with --local and open the LAN address on your phone.

MSG
  else
    echo "==> opening tunnel"
    ngrok http "$PORT" --log stdout | grep --line-buffered -o 'url=https://[^ ]*' &
    cat <<'MSG'

    Share the https:// URL ngrok prints. Two notes for a prototype:
      * anyone with that link can open the game and join a room, so treat the
        4-letter room code as the only thing keeping strangers out;
      * a free-tier URL changes every restart.

MSG
  fi
fi

wait
