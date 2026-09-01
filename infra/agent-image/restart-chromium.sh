#!/usr/bin/env bash
set -euo pipefail

pkill -TERM -u "$(id -u)" -f '/ms-playwright/.*/chrome( |$)' 2>/dev/null || true
for _ in $(seq 1 30); do
  pgrep -u "$(id -u)" -f '/ms-playwright/.*/chrome( |$)' >/dev/null 2>&1 || break
  sleep 0.1
done
pkill -KILL -u "$(id -u)" -f '/ms-playwright/.*/chrome( |$)' 2>/dev/null || true

rm -f \
  /home/agent/.relay-browser/SingletonCookie \
  /home/agent/.relay-browser/SingletonLock \
  /home/agent/.relay-browser/SingletonSocket

nohup /opt/relay/launch-chromium >/tmp/chromium.log 2>&1 </dev/null &
for _ in $(seq 1 100); do
  if curl --silent --fail --max-time 1 http://127.0.0.1:9222/json/version >/dev/null; then
    exit 0
  fi
  sleep 0.1
done

echo "Chromium did not become ready" >&2
exit 1
