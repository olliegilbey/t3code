#!/usr/bin/env bash
# The routine, run on the devbox: rebase terminal-mode onto upstream main, test it, build and
# install the server for this box, push, and tag the commit so the Mac builds the same one.
# fork/deploy.sh then moves the box's server onto the newest build once no turn is running.
# Exit codes, for the agent that runs it:
#   0  built and tagged, or nothing new
#   10 the rebase stopped on a conflict; it is left in progress
#   11 checks or tests failed; the log path is printed
#   12 the server build failed
#   13 the repo was not ready: wrong branch, dirty tree, or a git step failed
set -euo pipefail

BRANCH=terminal-mode
MAC=olliegilbey@100.92.4.70
KEEP=3

say() { printf '[rebuild] %s\n' "$*"; }
stop() {
  say "$2"
  exit "$1"
}

# Retries once: on a cold cache, Vite can reload mid-run and crash the browser tests.
run_twice() {
  local log=$1
  shift
  "$@" >"$log" 2>&1 && return 0
  say "Failed once; retrying: $*"
  "$@" >"$log" 2>&1
}

failed_files() {
  grep -oE '^ FAIL +\|[^|]+\| [^ ]+' "$1" | awk '{print $NF}' | sort -u
}

# The suite runs files in parallel, and some slow upstream tests time out under that load.
# A file that failed there runs again by itself, and fails the suite only if it fails alone too.
web_suite() {
  local log=$1 failed
  vp run --filter @t3tools/web test >"$log" 2>&1 && return 0
  failed=$(failed_files "$log")
  if [ -z "$failed" ]; then
    say "The web suite crashed without a failing test; running it again."
    vp run --filter @t3tools/web test >"$log" 2>&1 && return 0
    failed=$(failed_files "$log")
    [ -n "$failed" ] || return 1
  fi
  say "Failed in the full run: $(echo $failed). Running them alone."
  # shellcheck disable=SC2086 # one argument per file
  (cd apps/web && vp test run $failed) >"${log%.log}-alone.log" 2>&1 || return 1
  say "They pass alone, so they only time out under load: $(echo $failed)"
}

prune() {
  local home=$1 running version tag
  running=$(node -p 'require(process.argv[1]).serverVersion' "$HOME/.t3/userdata/server-runtime.json" 2>/dev/null || true)
  # Only versions this routine installed; the official runtimes beside them are not ours.
  local old
  old=$(sort -V "$home/runtimes" | uniq | head -n -"$KEEP")
  for version in $old; do
    [ "$version" = "$running" ] && continue
    rm -rf "$HOME/.t3/runtime/versions/$version" "$home/artifacts/t3-$version-linux-x64.tar.gz"
    grep -vxF "$version" "$home/runtimes" >"$home/runtimes.next" || true
    mv "$home/runtimes.next" "$home/runtimes"
  done
  for tag in $(git tag --list 'fork-build/*' | sort -V | head -n -"$KEEP"); do
    git push --quiet origin ":refs/tags/$tag" && git tag -d "$tag" >/dev/null
  done
}

# Retries a switch that failed or never ran; it does nothing once the newest build is serving.
deploy() {
  say "$("$1/fork/deploy.sh" 2>&1 || echo "Could not start the server switch.")"
}

main() {
  local repo home logs
  repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
  home=${T3_FORK_HOME:-$HOME/.local/share/t3-fork}
  logs=$home/logs
  export PATH="$HOME/.local/share/vite-plus/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
  export SSH_AUTH_SOCK=${SSH_AUTH_SOCK:-$HOME/.ssh/agent.sock}
  mkdir -p "$logs"
  cd "$repo"

  [ "$(git branch --show-current)" = "$BRANCH" ] || stop 13 "Not on $BRANCH."
  [ -z "$(git status --porcelain)" ] || stop 13 "The working tree has changes."
  git fetch --quiet upstream main || stop 13 "Could not fetch upstream."
  git fetch --quiet origin || stop 13 "Could not fetch origin."

  if ! git merge-base --is-ancestor upstream/main HEAD; then
    say "Rebasing onto upstream/main ($(git rev-list --count HEAD..upstream/main) new commits)."
    if ! git rebase --quiet upstream/main; then
      [ -n "$(git diff --name-only --diff-filter=U)" ] &&
        stop 10 "Conflicts in: $(git diff --name-only --diff-filter=U | tr '\n' ' ')"
      stop 13 "The rebase failed without a conflict. Check commit signing (SSH agent)."
    fi
  fi
  if [ -n "$(git tag --points-at HEAD --list 'fork-build/*')" ]; then
    say "Nothing new: $(git tag --points-at HEAD --list 'fork-build/*') is this commit."
    deploy "$repo"
    return
  fi

  local stamp
  stamp=$(date -u +%Y%m%d-%H%M)
  vp i >"$logs/$stamp-install.log" 2>&1 || stop 11 "Install failed. Log: $logs/$stamp-install.log"
  say "Running check:changed against upstream/main."
  run_twice "$logs/$stamp-checks.log" vp run check:changed upstream/main ||
    stop 11 "check:changed failed. Log: $logs/$stamp-checks.log"
  # Terminal mode lives in apps/web, so its whole suite runs, not only the changed files' tests.
  say "Running the full web test suite."
  web_suite "$logs/$stamp-web-tests.log" ||
    stop 11 "The web test suite failed. Logs: $logs/$stamp-web-tests*.log"

  local version
  version="$(node -p 'require("./apps/desktop/package.json").version')-nightly.$(date -u +%Y%m%d).9$(date -u +%H%M)"
  say "Building the server $version."
  "$repo/fork/build-server.sh" "$version" HEAD >"$logs/$stamp-server.log" 2>&1 ||
    stop 12 "The server build failed. Log: $logs/$stamp-server.log"
  "$repo/fork/install-runtime.sh" "$home/artifacts/t3-$version-linux-x64.tar.gz" "$version"
  echo "$version" >>"$home/runtimes"

  git push --quiet --force-with-lease origin "$BRANCH" || stop 13 "Push failed."
  git tag "fork-build/$version"
  git push --quiet origin "fork-build/$version" || stop 13 "Tag push failed."
  prune "$home"
  deploy "$repo"
  say "Tagged fork-build/$version at $(git rev-parse --short HEAD). The Mac builds it within the hour when awake and on power."
  say "Mac status: $(ssh -o BatchMode=yes -o ConnectTimeout=8 "$MAC" 'cat ~/.local/share/t3-fork/status 2>/dev/null || echo "no build yet"' 2>/dev/null || echo unreachable)"
}

# On one line, so an edit to this file while it runs cannot run stray lines after main.
main "$@"; exit
