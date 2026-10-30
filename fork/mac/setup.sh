#!/usr/bin/env bash
# One-time Mac setup for the fork's builds. Safe to run again; it skips what exists.
# - a build clone at ~/code/t3code-build
# - a signing certificate in its own keychain, so every build keeps one identity
# - a LaunchAgent that runs build-app.sh every hour
set -euo pipefail

HOME_DIR=$HOME/.local/share/t3-fork
BUILD=$HOME/code/t3code-build
AGENTS=$HOME/Library/LaunchAgents
FORK_URL=https://github.com/olliegilbey/t3code.git

clone() {
  [ -d "$BUILD/.git" ] && return
  git clone --quiet --branch terminal-mode "$FORK_URL" "$BUILD"
}

signing_identity() {
  local keychain=$HOME_DIR/signing.keychain-db
  [ -f "$HOME_DIR/signing-identity" ] && return
  local work password
  work=$(mktemp -d)
  trap "rm -rf '$work'" EXIT
  password=$(openssl rand -hex 24)
  cat >"$work/cert.cnf" <<'CNF'
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = T3 Code Fork Local Signing
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
CNF
  /usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$work/cert.cnf" \
    -keyout "$work/key.pem" -out "$work/cert.pem" 2>/dev/null
  /usr/bin/openssl pkcs12 -export -inkey "$work/key.pem" -in "$work/cert.pem" \
    -out "$work/identity.p12" -passout "pass:$password"
  (umask 077 && printf '%s' "$password" >"$HOME_DIR/signing-keychain-password")
  security create-keychain -p "$password" "$keychain"
  security set-keychain-settings "$keychain"
  security unlock-keychain -p "$password" "$keychain"
  security import "$work/identity.p12" -k "$keychain" -P "$password" -T /usr/bin/codesign >/dev/null
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain" >/dev/null
  /usr/bin/openssl x509 -in "$work/cert.pem" -noout -fingerprint -sha1 |
    sed 's/.*=//; s/://g' >"$HOME_DIR/signing-identity"
}

# codesign finds an identity only in a keychain on the user search list. Keeps every entry there.
search_list_add() {
  local keychain=$1 line entries=()
  while IFS= read -r line; do
    line=${line#"${line%%[![:space:]]*}"}
    line=${line#\"}
    line=${line%\"}
    [ "$line" = "$keychain" ] && return
    entries+=("$line")
  done < <(security list-keychains -d user)
  security list-keychains -d user -s "${entries[@]}" "$keychain"
}

launch_agent() {
  local label=$1 body=$2
  local plist=$AGENTS/$label.plist
  cat >"$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
$body
</dict>
</plist>
PLIST
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
}

# Builds turn off their own updates now. An older setup turned them off for every T3 app.
retire_update_switch() {
  local label=gg.ollie.t3-fork.env
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  rm -f "$AGENTS/$label.plist"
  launchctl unsetenv T3CODE_DISABLE_AUTO_UPDATE
}

main() {
  mkdir -p "$HOME_DIR" "$HOME/Library/Logs/t3-fork" "$HOME/.local/bin"
  clone
  signing_identity
  search_list_add "$HOME_DIR/signing.keychain-db"
  retire_update_switch
  launch_agent gg.ollie.t3-fork.build "  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$BUILD/fork/mac/build-app.sh</string></array>
  <key>StartInterval</key>
  <integer>3600</integer>
  <key>StandardOutPath</key>
  <string>$HOME/Library/Logs/t3-fork/agent.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/Library/Logs/t3-fork/agent.log</string>"
  echo "Set up. Signing identity $(cat "$HOME_DIR/signing-identity")."
}

# On one line, so an edit to this file while it runs cannot run stray lines after main.
main "$@"; exit
