// @effect-diagnostics nodeBuiltinImport:off - runs the fork's shell scripts as the routine does.
/**
 * Fork only. The Mac app asks the devbox for a runtime of exactly its own version, and a starting
 * server deletes every runtime but its own. A fork version is not on upstream's releases, so once
 * its runtime is gone the app's download 404s and it never connects (seen 2026-11-10). These run
 * the real fork/*.sh scripts, then the real prune, against a throwaway T3 home.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import * as HostProcess from "@t3tools/shared/HostProcess";

import * as ProcessRunner from "../processRunner.ts";
import { prunePinnedRuntimes } from "./pinnedRuntime.ts";

const forkDir = NodePath.resolve(import.meta.dirname, "../../../../fork");
const pinned = "0.1.7-nightly.20261105.90955";
const unpinned = "0.1.7-nightly.20261106.90311";

// One process, and it runs none of these runtimes. An empty list reads as no list at all.
const noProcesses = ProcessRunner.ProcessRunner.of({
  run: () =>
    Effect.succeed({
      stdout: "p1\nftxt\nn/sbin/launchd\n",
      stderr: "",
      code: ChildProcessSpawner.ExitCode(0),
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      stdoutInvalidUtf8: false,
      stderrInvalidUtf8: false,
    }),
});

it.layer(NodeServices.layer)("fork runtime pins", (it) => {
  const setup = Effect.fn(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-fork-pin-" });
    const env = {
      ...process.env,
      T3_HOME: path.join(root, "t3"),
      T3_FORK_HOME: path.join(root, "fork"),
    };
    const run = (script: string, ...args: ReadonlyArray<string>) =>
      Effect.sync(() =>
        NodeChildProcess.execFileSync("bash", [path.join(forkDir, script), ...args], {
          env,
          encoding: "utf8",
        }),
      );
    // A server archive as build-server.sh lays it out: one top directory holding `t3`.
    const archive = Effect.fn(function* (version: string) {
      const top = path.join(root, "src", `t3-${version}`);
      yield* fs.makeDirectory(top, { recursive: true });
      yield* fs.writeFileString(path.join(top, "t3"), `#!/bin/sh\necho "t3 v${version}"\n`);
      yield* fs.chmod(path.join(top, "t3"), 0o755);
      const file = path.join(root, `t3-${version}-linux-x64.tar.gz`);
      NodeChildProcess.execFileSync("tar", [
        "-czf",
        file,
        "-C",
        path.dirname(top),
        path.basename(top),
      ]);
      return file;
    });
    const prune = prunePinnedRuntimes({ baseDir: env.T3_HOME, keep: [] }).pipe(
      Effect.provideService(ProcessRunner.ProcessRunner, noProcesses),
      Effect.provideService(HostProcess.Platform, "darwin"),
      // Keeps the prune from finding the real ~/.local/bin/t3 or any t3 on PATH.
      Effect.provideService(HostProcess.Environment, {
        T3CODE_INSTALL_BIN_DIR: path.join(root, "no-bin"),
      }),
    );
    const versions = path.join(env.T3_HOME, "runtime", "versions");
    const installed = fs
      .readDirectory(versions)
      .pipe(Effect.map((entries) => entries.filter((entry) => !entry.startsWith(".")).toSorted()));
    // Dates every install long ago and moves the clock a day on, past the prune's one-hour
    // grace for a runtime installed just now.
    const settle = Effect.gen(function* () {
      for (const version of yield* installed) {
        yield* fs.utimes(path.join(versions, version, ".install-complete"), 0, 0);
      }
      yield* TestClock.setTime(Duration.toMillis(Duration.days(1)));
    });
    return { fs, path, env, run, archive, prune, versions, installed, settle };
  });

  it.effect("a starting server keeps a runtime install-runtime.sh installed", () =>
    Effect.gen(function* () {
      const { fs, path, run, archive, prune, versions, installed, settle } = yield* setup();
      yield* run("install-runtime.sh", yield* archive(pinned), pinned);
      // An unpinned runtime beside it shows the prune really runs.
      yield* fs.makeDirectory(path.join(versions, unpinned), { recursive: true });
      yield* fs.writeFileString(path.join(versions, unpinned, "t3"), "");
      yield* fs.writeFileString(path.join(versions, unpinned, ".install-complete"), unpinned);
      yield* settle;

      yield* prune;

      assert.deepEqual(yield* installed, [pinned]);
    }),
  );

  it.effect("pins a runtime installed before pins existed", () =>
    Effect.gen(function* () {
      const { fs, path, run, archive, prune, versions, installed, settle } = yield* setup();
      const file = yield* archive(pinned);
      // Installed by hand: the runtime and its sentinel, no pin.
      yield* fs.makeDirectory(path.join(versions, pinned), { recursive: true });
      yield* fs.writeFileString(path.join(versions, pinned, "t3"), "");
      yield* fs.writeFileString(path.join(versions, pinned, ".install-complete"), `${pinned}\n`);

      const out = yield* run("install-runtime.sh", file, pinned);
      yield* settle;
      yield* prune;

      assert.include(out, "already installed");
      assert.deepEqual(yield* installed, [pinned]);
    }),
  );

  it.effect("pinning twice records the launcher once", () =>
    Effect.gen(function* () {
      const { fs, path, env, run } = yield* setup();
      yield* run("runtime-pin.sh", "pin", pinned);
      yield* run("runtime-pin.sh", "pin", pinned);

      const records = (yield* fs.readFileString(path.join(env.T3_HOME, "runtime", "launchers")))
        .split("\n")
        .filter((line) => line.length > 0);
      assert.deepEqual(records, [path.join(env.T3_FORK_HOME, "pins", pinned, "t3")]);
    }),
  );

  it.effect("an unpinned runtime is pruned, and other launcher records stay", () =>
    Effect.gen(function* () {
      const { fs, path, env, run, archive, prune, installed, settle } = yield* setup();
      const launchers = path.join(env.T3_HOME, "runtime", "launchers");
      yield* run("install-runtime.sh", yield* archive(pinned), pinned);
      yield* fs.writeFileString(
        launchers,
        `/opt/t3/bin/t3\n${yield* fs.readFileString(launchers)}`,
      );

      yield* run("runtime-pin.sh", "unpin", pinned);
      yield* settle;
      yield* prune;

      assert.deepEqual(yield* installed, []);
      assert.isFalse(yield* fs.exists(path.join(env.T3_FORK_HOME, "pins", pinned)));
      assert.include(yield* fs.readFileString(launchers), "/opt/t3/bin/t3");
    }),
  );
});
