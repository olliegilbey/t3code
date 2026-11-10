#!/usr/bin/env bash
# Moves this box's T3 server onto the newest fork runtime, run as upstream's background service
# (t3code.service). A restart kills every running agent turn, including the one that ran
# rebuild.sh, so the switch waits in its own systemd unit until no turn is running.
# If the new server does not answer, the version that was serving is put back.
# Usage: fork/deploy.sh   (returns at once; the log is ~/.local/share/t3-fork/logs/deploy.log)
set -euo pipefail

UNIT=t3-fork-deploy
PORT=3773 # tailscale serve proxies :8443 here
PUBLIC_URL=https://t3.ollie.gg # Caddy (systemctl --user status caddy) proxies it to $PORT
T3_HOME=$HOME/.t3
RUNTIME_STATE=$T3_HOME/userdata/server-runtime.json
FORK_HOME=${T3_FORK_HOME:-$HOME/.local/share/t3-fork}
FORK_DIR=$(dirname "$(realpath "$0")")

say() { printf '[deploy %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }

running_turns() {
  sqlite3 -readonly "file:$T3_HOME/userdata/statev2.sqlite?mode=ro" \
    "select count(*) from orchestration_v2_projection_provider_turns where status = 'running'"
}

serving() { node -p "require(process.argv[1]).$1" "$RUNTIME_STATE" 2>/dev/null || true; }

answers() {
  [ "$(serving serverVersion)" = "$1" ] &&
    curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$PORT/"
}

public_version() {
  curl -fsS --max-time 10 "$PUBLIC_URL/.well-known/t3/environment" 2>/dev/null |
    node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).serverVersion' 2>/dev/null ||
    echo "nothing (unreachable)"
}

# The port can answer while Caddy points elsewhere, so a switch is done only once the public URL
# serves the new version too.
public_check() {
  local got
  got=$(public_version)
  [ "$got" = "$1" ] && { say "$PUBLIC_URL serves $1."; return; }
  say "Warning: $PUBLIC_URL serves $got, not $1. Check Caddy: systemctl --user status caddy."
  return 1
}

# Adds KEY=VALUE to service.env unless the key is already set there.
service_env() {
  local file=$T3_HOME/service.env
  grep -q "^$1=" "$file" 2>/dev/null || printf '%s=%s\n' "$1" "$2" >>"$file"
  chmod 600 "$file"
}

# A server started by hand (or by an SSH launch) holds the port and the T3 home, so the service
# cannot start beside it. Stop it only after confirming it owns the port and is not the service.
stop_hand_started() {
  local pid
  pid=$(serving pid)
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 0
  grep -q '/t3code.service' "/proc/$pid/cgroup" && return 0
  ss -H -ltnp "sport = :$PORT" | grep -q "pid=$pid," || {
    say "PID $pid in $RUNTIME_STATE does not own port $PORT; leaving it."
    return 1
  }
  say "Stopping the hand-started server, PID $pid: $(tr '\0' ' ' <"/proc/$pid/cmdline")"
  kill "$pid"
  for _ in $(seq 60); do kill -0 "$pid" 2>/dev/null || return 0; sleep 1; done
  say "PID $pid did not stop in 60s; killing it."
  kill -9 "$pid"
}

newest() { sort -V "$FORK_HOME/runtimes" | tail -n 1; }

# A server deletes every other runtime when it starts, so one installed earlier may be gone.
ensure_runtime() {
  [ -f "$T3_HOME/runtime/versions/$1/.install-complete" ] ||
    "$FORK_DIR/install-runtime.sh" "$FORK_HOME/artifacts/t3-$1-linux-x64.tar.gz" "$1"
}

install_service() {
  "$T3_HOME/runtime/versions/$1/t3" service install --base-dir "$T3_HOME" "${@:2}"
}

wait_until_answers() {
  for _ in $(seq 450); do answers "$1" && return 0; sleep 2; done
  return 1
}

run() {
  local target previous turns
  [ "$(newest)" = "$(serving serverVersion)" ] && {
    say "Already serving $(newest)."
    public_check "$(newest)"
    return
  }
  say "Switching to the newest fork runtime once no turn is running."
  while :; do
    turns=$(running_turns) || { say "Could not read running turns; not switching."; return 1; }
    [ "$turns" = 0 ] && break
    sleep 60
  done
  # Read after the wait: a rebuild meanwhile may have added a newer runtime.
  target=$(newest)
  previous=$(serving serverVersion)
  [ "$target" = "$previous" ] && {
    say "Already serving $target."
    public_check "$target"
    return
  }
  say "Switching $previous -> $target."
  ensure_runtime "$target" || { say "Could not install $target; not switching."; return 1; }
  service_env T3CODE_PORT "$PORT"
  # The user manager's agent is GNOME's; commit signing and pushes use 1Password's.
  service_env SSH_AUTH_SOCK "$HOME/.ssh/agent.sock"
  stop_hand_started
  if install_service "$target" && wait_until_answers "$target"; then
    say "Serving $target."
    public_check "$target"
    return
  fi
  [ -n "$previous" ] || { say "$target did not answer, and nothing served before it."; return 1; }
  say "$target did not answer within 15 minutes; putting $previous back."
  ensure_runtime "$previous" && install_service "$previous" --allow-downgrade &&
    wait_until_answers "$previous" && { say "Serving $previous again."; return 1; }
  say "$previous did not come back either. Over SSH: systemctl --user status t3code; logs in $T3_HOME/userdata/logs."
  return 1
}

main() {
  if [ "${1:-}" = --run ]; then
    run
    return
  fi
  local logs=$FORK_HOME/logs
  mkdir -p "$logs"
  # A waiting switch takes the newest runtime when it runs, so one waiter is enough.
  if systemctl --user is-active --quiet "$UNIT"; then
    echo "A switch is already waiting for idle. Log: $logs/deploy.log"
  else
    systemd-run --user --quiet --collect --unit="$UNIT" \
      --property=StandardOutput="append:$logs/deploy.log" \
      --property=StandardError="append:$logs/deploy.log" \
      --setenv=T3_FORK_HOME="${T3_FORK_HOME:-}" \
      /usr/bin/env bash "$(realpath "$0")" --run
    echo "The server switches to the newest fork runtime once no turn is running. Log: $logs/deploy.log"
  fi
  echo "$PUBLIC_URL serves $(public_version) now. The log says when it serves the new version."
}

# On one line, so an edit to this file while it runs cannot run stray lines after main.
main "$@"; exit
