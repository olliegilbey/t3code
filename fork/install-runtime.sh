#!/usr/bin/env bash
# Installs a server archive where the Mac app's SSH launcher looks for its own version,
# the way packages/ssh/src/tunnel.ts installs a downloaded one, and pins it (fork/runtime-pin.sh)
# so a starting server keeps it. The running server is untouched.
# Usage: fork/install-runtime.sh <archive> <version>
set -euo pipefail

main() {
  local archive=$1 version=$2
  local versions=${T3_HOME:-$HOME/.t3}/runtime/versions
  local target=$versions/$version
  # Pinned before the check: runtimes installed before pins existed get one too.
  "$(dirname "$(realpath "$0")")/runtime-pin.sh" pin "$version"
  if [ "$(cat "$target/.install-complete" 2>/dev/null)" = "$version" ]; then
    echo "Runtime $version is already installed."
    return
  fi
  mkdir -p "$versions"
  local staging
  staging=$(mktemp -d "$versions/.staging-XXXXXX")
  trap "rm -rf '$staging'" EXIT
  tar -xzf "$archive" -C "$staging" --strip-components=1
  [ "$("$staging/t3" --version)" = "t3 v$version" ]
  printf '%s\n' "$version" >"$staging/.install-complete"
  rm -rf "$target"
  mv "$staging" "$target"
  echo "Installed runtime $version."
}

# On one line, so an edit to this file while it runs cannot run stray lines after main.
main "$@"; exit
