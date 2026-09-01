#!/usr/bin/env bash
set -euo pipefail

chromium_bin="$(find /ms-playwright -type f -name chrome -perm -111 -print -quit)"
[[ -n "$chromium_bin" ]] || exit 1

export GOOGLE_API_KEY="${GOOGLE_API_KEY:-no}"
export GOOGLE_DEFAULT_CLIENT_ID="${GOOGLE_DEFAULT_CLIENT_ID:-no}"
export GOOGLE_DEFAULT_CLIENT_SECRET="${GOOGLE_DEFAULT_CLIENT_SECRET:-no}"

if ! pgrep -u "$(id -u)" -f '/ms-playwright/.*/chrome( |$)' >/dev/null 2>&1; then
  rm -f \
    /home/agent/.relay-browser/SingletonCookie \
    /home/agent/.relay-browser/SingletonLock \
    /home/agent/.relay-browser/SingletonSocket
fi

"$chromium_bin" \
  --no-sandbox \
  --test-type \
  --disable-dev-shm-usage \
  --no-first-run \
  --no-default-browser-check \
  --hide-crash-restore-bubble \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --remote-allow-origins='*' \
  --ignore-gpu-blocklist \
  --enable-unsafe-swiftshader \
  --use-angle=swiftshader \
  --renderer-process-limit=8 \
  --user-data-dir=/home/agent/.relay-browser \
  --start-maximized \
  https://www.google.com &

browser_pid=$!
for _ in $(seq 1 40); do
  if wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz 2>/dev/null; then
    break
  fi
  sleep 0.1
done

wait "$browser_pid"
