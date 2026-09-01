#!/usr/bin/env bash
set -euo pipefail

if [[ "${RELAY_BROWSER:-0}" == "1" ]]; then
  mkdir -p /tmp/.X11-unix /home/agent/.relay-browser
  Xvfb :99 -screen 0 1440x900x24 -nolisten tcp -ac &
  sleep 0.5
  openbox >/tmp/openbox.log 2>&1 &
  feh --no-fehbg --bg-fill /opt/relay/wallpaper.png >/tmp/wallpaper.log 2>&1 &
  tint2 -c /opt/relay/tint2rc >/tmp/tint2.log 2>&1 &
  x11vnc -display :99 -forever -shared -nopw -rfbport 5900 -localhost >/tmp/x11vnc.log 2>&1 &
  websockify --web=/usr/share/novnc 6080 localhost:5900 >/tmp/websockify.log 2>&1 &
  /opt/relay/launch-chromium >/tmp/chromium.log 2>&1 &
else
  exec sleep infinity
fi

shutdown() {
  trap - TERM INT
  jobs -pr | xargs -r kill 2>/dev/null || true
  wait || true
  exit 0
}
trap shutdown TERM INT

# Remain the direct parent of the desktop services and reap any short-lived
# helpers. Leaving them attached to `tail -f` caused Chrome/desktop zombies to
# accumulate until the sandbox could no longer create renderer threads.
while [[ -n "$(jobs -pr)" ]]; do
  wait -n || true
done
