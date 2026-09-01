FROM mcr.microsoft.com/playwright:v1.55.0-noble

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates curl git jq openssh-client python3 python3-pip ripgrep \
    xdg-utils file unzip zip less nano dbus-x11 libsecret-1-0 gnome-keyring \
    fonts-liberation fonts-noto-color-emoji \
    xvfb x11vnc novnc websockify openbox xterm tint2 feh librsvg2-bin wmctrl xdotool xclip scrot \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 --shell /bin/bash agent \
  && mkdir -p /workspace /home/agent/.relay-browser /home/agent/Downloads /home/agent/Desktop \
  && chown -R agent:agent /workspace /home/agent \
  && npm install --global playwright@1.55.0

COPY --chown=agent:agent infra/agent-image/start-sandbox.sh /usr/local/bin/start-sandbox
COPY --chown=agent:agent infra/agent-image/launch-chromium.sh /opt/relay/launch-chromium
COPY --chown=agent:agent infra/agent-image/browser-control.mjs /opt/relay/browser-control.mjs
COPY --chown=agent:agent infra/agent-image/desktop-control.mjs /opt/relay/desktop-control.mjs
COPY --chown=agent:agent infra/agent-image/desktop-control.py /opt/relay/desktop-control.py
COPY --chown=agent:agent infra/agent-image/restart-chromium.sh /opt/relay/restart-chromium
COPY --chown=agent:agent infra/agent-image/start.html /opt/relay/start.html
COPY --chown=agent:agent infra/agent-image/wallpaper.svg /opt/relay/wallpaper.svg
COPY --chown=agent:agent infra/agent-image/chrome-icon.svg /opt/relay/chrome-icon.svg
COPY --chown=agent:agent infra/agent-image/terminal-icon.svg /opt/relay/terminal-icon.svg
COPY --chown=agent:agent infra/agent-image/chromium.desktop /opt/relay/chromium.desktop
COPY --chown=agent:agent infra/agent-image/terminal.desktop /opt/relay/terminal.desktop
COPY --chown=agent:agent infra/agent-image/tint2rc /opt/relay/tint2rc
COPY infra/agent-image/relay-vnc.html /usr/share/novnc/relay.html
COPY infra/agent-image/novnc-package.json /usr/share/novnc/package.json
RUN rsvg-convert -w 1440 -h 900 /opt/relay/wallpaper.svg -o /opt/relay/wallpaper.png \
  && rsvg-convert -w 96 -h 96 /opt/relay/chrome-icon.svg -o /opt/relay/chrome-icon.png \
  && rsvg-convert -w 96 -h 96 /opt/relay/terminal-icon.svg -o /opt/relay/terminal-icon.png \
  && chmod 0555 /usr/local/bin/start-sandbox /opt/relay/launch-chromium /opt/relay/browser-control.mjs /opt/relay/desktop-control.mjs /opt/relay/desktop-control.py /opt/relay/restart-chromium

USER agent
WORKDIR /workspace
ENV HOME=/home/agent
ENV DISPLAY=:99
ENV NODE_PATH=/usr/lib/node_modules
EXPOSE 6080
ENTRYPOINT ["/usr/local/bin/start-sandbox"]
