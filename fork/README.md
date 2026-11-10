# Fork tooling

This fork carries Terminal mode on top of upstream `main`. These scripts keep a build of it as the
daily driver: the T3 Code app on the Mac, and the server it starts on the devbox over SSH. The Mac
app also runs a local server of its own, inside the app.

The Mac app asks the devbox for a server of exactly its own version, so both halves are built from
one commit under one version, `<desktop version>-nightly.<date>.9<HHMM>`. The nightly form keeps the
Nightly icon and branding. The `9` keeps the build number clear of official ones.

## Updating

A build reaches each machine separately. Either can stay on an older build until you update it.

- **Devbox server.** `deploy.sh` moves it onto the new build once no turn is running there. Nothing
  to do by hand.
- **Mac app, UI and local server together.** The Mac builds the new tag, then `t3-swap` installs it.
  Quitting the app stops its local server and any turn running on it, so swap when the Mac's own
  threads are idle.
- **Version match.** The Mac app needs its own version on the devbox. The devbox keeps the last
  three builds, so the Mac can be up to two builds behind.

## The stack

`terminal-mode` is upstream `main` plus one commit per feature, rebased, never merged. Each commit
ends with a `Fork-Feature:` trailer. They sit in layers, so a conflict names its feature:

| Layer | Trailer         | Holds                                                          | Conflicts                                        |
| ----- | --------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| 1     | `tooling`       | `fork/` and its test                                           | Never: upstream has no `fork/`                   |
| 2     | `desktop`       | One commit per desktop or SSH fix                              | Rare. Each could go upstream, and then drops out |
| 3     | `terminal-mode` | Terminal mode, vim keys, the permission prompt, the statusline | Where upstream edits the chat UI                 |

List it: `git log --reverse --format='%h %(trailers:key=Fork-Feature,valueonly,separator=) %s' upstream/main..terminal-mode`.

Rules:

- **A fix to a feature folds into its commit.** `git commit --fixup <sha>`. `rebuild.sh` folds it
  in with `--autosquash` on its next run. Folded fixes stop repeating the same conflict.
- **A new feature is a new commit** with its own trailer, at the top of the stack. Keep it in new
  files where you can: edits inside upstream files are what conflict.
- **PRs into `terminal-mode` squash-merge.** `rebuild.sh` fast-forwards to `origin` first, then
  flattens any merge commit, so a merged PR is never dropped.
- **Conflicts are remembered.** The rebase runs with `rerere`, so a conflict resolved once
  resolves itself next time.
- `terminal-mode-backup-<date>` branches hold the stack before a hand restack.

## Devbox

- `rebuild.sh` is the routine. It fast-forwards to `origin`, rebases onto upstream `main` with
  fixups folded in, prints the stack, runs `check:changed` and the full web suite, builds and
  installs the server, pushes, tags the commit `fork-build/<version>`, and runs `deploy.sh`. Its
  header lists the exit codes an agent acts on. A T3 scheduled task runs it at 03:00 on Monday,
  Wednesday and Friday.
- `build-server.sh` builds the linux-x64 server archive in its own clone, as the release workflow
  does, and runs the archive smoke test.
- `install-runtime.sh` installs an archive into `~/.t3/runtime/versions/<version>` and pins it. It
  leaves the running server alone.
- `runtime-pin.sh` pins a runtime, or unpins one `rebuild.sh` retires. A starting server deletes
  every runtime but its own, a reboot included. The Mac app then asks for its version, finds none,
  and tries upstream's releases, where fork versions 404. A pin is a link in
  `~/.local/share/t3-fork/pins` listed in `~/.t3/runtime/launchers`, which the prune keeps.
  `apps/server/src/cloud/forkRuntimePin.test.ts` runs both scripts against the real prune.
- `deploy.sh` moves the box's server onto the newest fork runtime, run as upstream's background
  service (`systemctl --user status t3code`). A restart would kill every running turn, the
  scheduled task's included, so the switch waits in its own systemd unit (`t3-fork-deploy`) until
  no turn is running, then takes the newest runtime. A starting server deletes every runtime
  but its own, so the switch reinstalls its target, or the previous version it falls back to,
  from `artifacts/`. It sets `T3CODE_PORT=3773`, where `tailscale serve` points
  `:8443`, and the 1Password `SSH_AUTH_SOCK` in `~/.t3/service.env`. Log: `logs/deploy.log`.
  Every agent the server starts inherits `T3CODE_PORT`, and Vite then proxies a web test's
  requests to the live server. `rebuild.sh` clears the server's variables first. Do the same
  for a test you run by hand: `env -u T3CODE_PORT -u T3CODE_HOME vp test run …`.

The server serves its own web app, so the browser at `https://ollie-xps.fynbos-mountain.ts.net:8443`
(tailnet only) gets Terminal mode from the same build as the server. So does `https://t3.ollie.gg`,
which Caddy proxies to the same port. `rebuild.sh` prints the version it serves, and `deploy.sh`
logs a warning when it does not serve the new one after a switch.

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
  reopens it. That restarts the Mac's local server too. `t3-swap --rollback` puts the previous
  build back, and `t3-swap --restart` only restarts it. It opens the app with the bare environment
  the Dock gives, not the terminal's, so a project's mise `GH_TOKEN` never reaches the server. The
  official app is never touched.

The certificate gives every build the same identity, so keychain access and macOS permissions
granted once stay granted. Logs are in `~/Library/Logs/t3-fork`.
