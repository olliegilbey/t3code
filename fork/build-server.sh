#!/usr/bin/env bash
# Builds the linux-x64 t3 server archive for one commit, the way release-desktop.yml does.
# Usage: fork/build-server.sh <version> <commit>
# Prints the archive path on its last line.
set -euo pipefail

main() {
  local version=$1
  local repo home build out commit
  repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
  commit=$(git -C "$repo" rev-parse --verify "$2^{commit}")
  home=${T3_FORK_HOME:-$HOME/.local/share/t3-fork}
  build=$home/build/t3code
  out=$home/artifacts
  export PATH="$HOME/.local/share/vite-plus/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH"

  # The build stamps versions into package.json files, so it runs in its own clone.
  [ -d "$build/.git" ] || git clone --quiet --no-checkout "$repo" "$build"
  git -C "$build" fetch --quiet "$repo" "$commit"
  git -C "$build" checkout --quiet --force --detach FETCH_HEAD
  git -C "$build" clean -fdxq -e node_modules -e /native/resource-monitor/target
  cd "$build"

  # Every Node step uses the exact engines.node, which the executable embeds.
  local node_version
  node_version=$(node -p 'require("./package.json").engines.node')
  # Named by path: in system-first mode, `vp env exec --node` can still return the system Node.
  vp env install "node@$node_version" >/dev/null
  PATH="$HOME/.local/share/vite-plus/js_runtime/node/$node_version/bin:$PATH"
  [ "$(node --version)" = "v$node_version" ]

  vp i --frozen-lockfile
  node scripts/update-release-package-versions.ts "$version"
  T3CODE_TELEMETRY_CHANNEL=dev vp run --filter t3 build
  node scripts/apply-web-brand-assets.ts nightly apps/server/dist/client
  T3CODE_TELEMETRY_CHANNEL=dev node apps/server/scripts/cli.ts build-exe

  cargo build --locked --release --manifest-path native/resource-monitor/Cargo.toml
  local monitor
  monitor=$(mktemp -d)
  trap "rm -rf '$monitor'" EXIT
  mkdir -p "$monitor/linux-x64" "$out"
  cp native/resource-monitor/target/release/t3-resource-monitor "$monitor/linux-x64/"

  node scripts/build-cli-archive.ts --platform linux --arch x64 --version "$version" \
    --resource-monitor-dir "$monitor" --output-dir "$out"
  local archive=$out/t3-$version-linux-x64.tar.gz
  node scripts/smoke-cli-archive.ts --archive "$archive" --expect-version "$version"
  echo "$archive"
}

# On one line, so an edit to this file while it runs cannot run stray lines after main.
main "$@"; exit
