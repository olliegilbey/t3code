# Fork tooling

This fork carries Terminal mode on top of upstream `main`. These scripts keep a build of it as the
daily driver: the T3 Code app on the Mac, and the server it starts on the devbox over SSH.

The Mac app asks the devbox for a server of exactly its own version, so both halves are built from
one commit under one version, `<desktop version>-nightly.<date>.9<HHMM>`. The nightly form keeps the
Nightly icon and branding. The `9` keeps the build number clear of official ones.

## Devbox

- `rebuild.sh` is the routine. It rebases onto upstream `main`, runs `check:changed` and the full
  web suite, builds and installs the server, pushes, and tags the commit `fork-build/<version>`.
  Its header lists the exit codes an agent acts on. A T3 scheduled task runs it every two nights.
- `build-server.sh` builds the linux-x64 server archive in its own clone, as the release workflow
  does, and runs the archive smoke test.
- `install-runtime.sh` installs an archive into `~/.t3/runtime/versions/<version>`. A server that is
  running keeps running; the new version starts the next time the server restarts.

State lives in `~/.local/share/t3-fork`: the build clone, archives, logs, and the list of runtimes
the routine installed. Only those runtimes are pruned.

## Mac

The build installs as its own app, `T3 Code (Terminal)`, beside the official app, which keeps
updating itself. Both can run at once and use the same devbox server. The fork has its own app ID
(`gg.ollie.t3code.terminal`) and Chromium profile (`t3code-terminal`, named by
`T3CODE_DESKTOP_PROFILE`), so window state and macOS permissions stay apart. Settings, sign-in and
saved connections live in `~/.t3/userdata`, which both apps read.

- `mac/setup.sh` runs once. It clones the fork to `~/code/t3code-build`, makes a signing
  certificate in its own keychain, and adds a LaunchAgent that runs `mac/build-app.sh` every hour.
- `mac/build-app.sh` builds the newest `fork-build/*` tag when the Mac is on power, signs it, and
  stages it in `~/.local/share/t3-fork/staged`. The build turns off its own updates. A
  notification says when it is ready.
- `mac/t3-swap.sh`, installed as `t3-swap`, quits the fork's app, swaps the staged build in, and
  reopens it. `t3-swap --rollback` puts the previous build back. The official app is never touched.

The certificate gives every build the same identity, so keychain access and macOS permissions
granted once stay granted. Logs are in `~/Library/Logs/t3-fork`.
