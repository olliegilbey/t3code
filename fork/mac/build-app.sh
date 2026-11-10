#!/usr/bin/env bash
# Runs on the Mac. Builds T3 Code for the newest fork-build/<version> tag, signs it with the
# local signing certificate, and stages it for t3-swap. A LaunchAgent runs it every hour.
# The build is its own app, "T3 Code (Terminal)", so it runs beside the official one.
# Usage: fork/mac/build-app.sh [--force]   (--force builds on battery and rebuilds a staged version)
set -euo pipefail

APP_NAME="T3 Code (Terminal)"
APP_ID=gg.ollie.t3code.terminal
# electron-builder names the bundle after the product. That stays the official one, as in earlier
# builds that read the encrypted settings both apps share. The installed bundle takes APP_NAME.
BUILT_NAME="T3 Code (Nightly)"
HOME_DIR=$HOME/.local/share/t3-fork
BUILD=$HOME/code/t3code-build
LOGS=$HOME/Library/Logs/t3-fork

notify() {
  osascript -e "display notification \"$1\" with title \"T3 Code fork\"" >/dev/null 2>&1 || true
}

main() {
  local force=${1:-}
  export PATH="$HOME/.local/share/vite-plus/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  mkdir -p "$HOME_DIR" "$LOGS"
  mkdir "$HOME_DIR/build.lock" 2>/dev/null || { echo "Another build is running."; return; }
  trap "rmdir '$HOME_DIR/build.lock'" EXIT

  git -C "$BUILD" fetch --quiet --force --prune --prune-tags origin '+refs/tags/fork-build/*:refs/tags/fork-build/*'
  local tag version installed staged
  tag=$(git -C "$BUILD" tag --list 'fork-build/*' | sort -V | tail -1)
  [ -n "$tag" ] || { echo "No fork-build tag yet."; return; }
  version=${tag#fork-build/}
  installed=$(defaults read "/Applications/$APP_NAME.app/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || true)
  staged=$(cat "$HOME_DIR/staged/version" 2>/dev/null || true)
  if [ "$force" != "--force" ]; then
    if [ "$version" = "$installed" ] || [ "$version" = "$staged" ]; then return; fi
    if [ "$(cat "$HOME_DIR/failed" 2>/dev/null)" = "$version" ]; then return; fi
    pmset -g batt | grep -q "AC Power" || { echo "On battery; $version waits for power."; return; }
  fi

  local log=$LOGS/build-$version.log
  echo "Building $version. Log: $log"
  # In the background, not in an `if`: a condition would switch off set -e inside build.
  local status=0
  (build "$version") >"$log" 2>&1 &
  wait $! || status=$?
  if [ "$status" -ne 0 ]; then
    echo "$version" >"$HOME_DIR/failed"
    echo "failed $version" >"$HOME_DIR/status"
    notify "Build $version failed. See $log"
    return 1
  fi
  rm -f "$HOME_DIR/failed"
  echo "staged $version" >"$HOME_DIR/status"
  notify "T3 Code $version is ready. Run t3-swap to switch."
}

build() {
  local version=$1
  local identity keychain=$HOME_DIR/signing.keychain-db
  identity=$(cat "$HOME_DIR/signing-identity")

  git -C "$BUILD" checkout --quiet --force --detach "fork-build/$version"
  git -C "$BUILD" clean -fdxq -e node_modules -e /native/resource-monitor/target
  cd "$BUILD"

  local node_version
  node_version=$(node -p 'require("./package.json").engines.node')
  # Named by path: in system-first mode, `vp env exec --node` can still return the system Node.
  vp env install "node@$node_version" >/dev/null
  PATH="$HOME/.local/share/vite-plus/js_runtime/node/$node_version/bin:$PATH"
  [ "$(node --version)" = "v$node_version" ]

  vp i --frozen-lockfile
  node scripts/update-release-package-versions.ts "$version"
  T3CODE_TELEMETRY_CHANNEL=dev vp run build:desktop
  local out=$HOME_DIR/out
  rm -rf "$out"
  T3CODE_DESKTOP_APP_ID=$APP_ID node scripts/build-desktop-artifact.ts \
    --platform mac --target dir --arch arm64 \
    --build-version "$version" --skip-build --output-dir "$out" --verbose

  local app
  app=$(find "$out" -maxdepth 3 -name "$BUILT_NAME.app" -type d | head -1)
  [ -n "$app" ]
  local plist=$app/Contents/Info.plist
  [ "$(defaults read "$plist" CFBundleShortVersionString)" = "$version" ]
  [ "$(defaults read "$plist" CFBundleIdentifier)" = "$APP_ID" ]
  # Its own profile lets it run while the official app does. It skips updates, which would bring
  # the official build. macOS sets these for every launch through Finder, the Dock or `open`.
  plutil -replace CFBundleDisplayName -string "$APP_NAME" "$plist"
  plutil -replace LSEnvironment -json \
    '{"T3CODE_DESKTOP_PROFILE":"t3code-terminal","T3CODE_DISABLE_AUTO_UPDATE":"true"}' "$plist"

  # One stable certificate keeps the app's identity across builds, so keychain items and
  # macOS permissions granted once stay granted.
  security unlock-keychain -p "$(cat "$HOME_DIR/signing-keychain-password")" "$keychain"
  codesign --force --deep --sign "$identity" --keychain "$keychain" "$app"
  codesign --verify --deep --strict "$app"

  rm -rf "$HOME_DIR/staged.next"
  mkdir -p "$HOME_DIR/staged.next"
  ditto "$app" "$HOME_DIR/staged.next/$APP_NAME.app"
  echo "$version" >"$HOME_DIR/staged.next/version"
  rm -rf "$HOME_DIR/staged"
  mv "$HOME_DIR/staged.next" "$HOME_DIR/staged"
  rm -rf "$out"
  install -m 755 fork/mac/t3-swap.sh "$HOME/.local/bin/t3-swap"
}

# On one line: the checkout above rewrites this file while it runs.
main "$@"; exit
