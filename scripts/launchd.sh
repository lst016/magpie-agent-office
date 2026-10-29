#!/bin/sh
# Keep the Agent Office server running from login: install | uninstall | status
set -eu
LABEL=com.agent-office.server
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR=$(cd "$(dirname "$0")/.." && pwd -P)
LOG="$HOME/.config/agent-office/server.log"

case "${1:-status}" in
  install)
    # the real binary, not a version manager's shim: launchd stops what it started,
    # and a shim's child left behind would keep the port
    NODE=$(volta which node 2>/dev/null || command -v node)
    mkdir -p "$HOME/.config/agent-office" "$HOME/Library/LaunchAgents"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/server/office.mjs</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$NODE"):$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
EOF
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    pkill -f "$DIR/server/office.mjs" 2>/dev/null || true
    sleep 1
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "installed: $PLIST (log: $LOG)"
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    [ -f "$PLIST" ] && trash "$PLIST" 2>/dev/null || rm -f "$PLIST"
    echo "uninstalled"
    ;;
  status)
    launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E 'state|pid' || echo "not installed"
    ;;
  *) echo "usage: $0 install|uninstall|status" >&2; exit 2 ;;
esac
