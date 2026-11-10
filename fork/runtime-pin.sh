#!/usr/bin/env bash
# Pins a fork runtime so a starting server keeps it, or unpins one being retired.
#
# A server deletes every runtime but its own when it starts, a reboot included. The Mac app asks
# for a runtime of exactly its own version and, when it is missing, downloads it from upstream's
# releases, where fork versions do not exist: the download 404s and the app never connects.
# The prune keeps any runtime a launcher listed in ~/.t3/runtime/launchers resolves into, so a pin
# is a link to the runtime's t3 plus that line.
# Usage: fork/runtime-pin.sh pin|unpin <version>
set -euo pipefail

main() {
  local action=$1 version=$2
  local t3_home=${T3_HOME:-$HOME/.t3}
  local fork_home=${T3_FORK_HOME:-$HOME/.local/share/t3-fork}
  local launchers=$t3_home/runtime/launchers
  local link=$fork_home/pins/$version/t3
  case $action in
  pin)
    mkdir -p "$(dirname "$link")" "$(dirname "$launchers")"
    ln -sfn "$t3_home/runtime/versions/$version/t3" "$link"
    # A line without its newline may end the file; a blank line is skipped when read.
    grep -qxF "$link" "$launchers" 2>/dev/null || printf '\n%s\n' "$link" >>"$launchers"
    ;;
  unpin)
    rm -rf "$fork_home/pins/$version"
    if [ -f "$launchers" ]; then
      grep -vxF "$link" "$launchers" >"$launchers.next" || true
      mv "$launchers.next" "$launchers"
    fi
    ;;
  *)
    echo "Usage: $0 pin|unpin <version>" >&2
    return 2
    ;;
  esac
}

# On one line, so an edit to this file while it runs cannot run stray lines after main.
main "$@"; exit
