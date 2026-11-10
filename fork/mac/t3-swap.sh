#!/usr/bin/env bash
# Runs on the Mac. Quits the fork's app, swaps the staged build into /Applications, and reopens
# it. The official app is a separate app and keeps running. The replaced build is kept, and
# `t3-swap --rollback` puts it back. `t3-swap --restart` only quits and reopens it.
set -euo pipefail

APP_NAME="T3 Code (Terminal)"
APP_ID=gg.ollie.t3code.terminal
APP="/Applications/$APP_NAME.app"
HOME_DIR=$HOME/.local/share/t3-fork
# pgrep takes a regex, so the parentheses and dot are escaped.
MAIN_PROCESS='^/Applications/T3 Code \(Terminal\)\.app/Contents/MacOS/'
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

running() {
  pgrep -f "$MAIN_PROCESS" >/dev/null
}

wait_until_gone() {
  local pattern=$1 seconds=$2
  while pgrep -f "$pattern" >/dev/null && [ "$seconds" -gt 0 ]; do
    sleep 1
    seconds=$((seconds - 1))
  done
  ! pgrep -f "$pattern" >/dev/null
}

version_of() {
  defaults read "$1/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo unknown
}

quit_app() {
  running || return 0
  echo "Quitting $APP_NAME..."
  # By ID: the official app's name differs only in the bundle folder.
  osascript -e "tell application id \"$APP_ID\" to quit" >/dev/null || true
  wait_until_gone "$MAIN_PROCESS" 60 || { echo "$APP_NAME is still open. Nothing changed."; exit 1; }
}

# `open` hands the app this shell's environment, and its server and agents inherit it, such as
# the GH_TOKEN mise sets inside a project. Start it bare, as the Dock does; the app reads PATH
# and the rest it needs from the login shell.
launch() {
  env -i HOME="$HOME" USER="$USER" LOGNAME="${LOGNAME:-$USER}" SHELL="${SHELL:-/bin/zsh}" \
    TMPDIR="$(getconf DARWIN_USER_TEMP_DIR)" PATH=/usr/bin:/bin:/usr/sbin:/sbin open "$APP"
}

main() {
  if [ "${1:-}" = "--restart" ]; then
    quit_app
    launch
    echo "Restarted $(version_of "$APP")."
    return
  fi
  local from=staged to=previous
  if [ "${1:-}" = "--rollback" ]; then from=previous to=staged; fi
  local incoming=$HOME_DIR/$from/$APP_NAME.app
  [ -d "$incoming" ] || { echo "Nothing to swap in: $incoming is missing."; exit 1; }
  codesign --verify --deep --strict "$incoming"

  quit_app

  local outgoing=$HOME_DIR/$to.next
  rm -rf "$outgoing"
  mkdir -p "$outgoing"
  if [ -d "$APP" ]; then
    mv "$APP" "$outgoing/$APP_NAME.app"
    version_of "$outgoing/$APP_NAME.app" >"$outgoing/version"
  fi
  mv "$incoming" "$APP"
  rm -rf "$HOME_DIR/${from:?}" "$HOME_DIR/${to:?}"
  mv "$outgoing" "$HOME_DIR/$to"
  xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
  # Launch Services reads the app's environment (its profile) from Info.plist when it registers it.
  "$LSREGISTER" -f "$APP"
  echo "installed $(version_of "$APP")" >"$HOME_DIR/status"
  echo "Installed $(version_of "$APP"). Kept $(cat "$HOME_DIR/$to/version" 2>/dev/null || echo nothing) in $HOME_DIR/$to."
  launch
}

# On one line, so an edit to this file while it runs cannot run stray lines after main.
main "$@"; exit
