// @effect-diagnostics nodeBuiltinImport:off - runs the fork's shell script as Ollie does.
/**
 * Fork only. A Mac app newer than the devbox server cannot connect once the build adds database
 * migrations. These run the real fork/mac/t3-swap.sh in a throwaway home, with stubs for the
 * macOS-only `defaults` and `codesign` and a file:// URL for the devbox.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

const swapScript = NodePath.resolve(import.meta.dirname, "../../../../fork/mac/t3-swap.sh");
const served = "0.1.11-nightly.20261123.91958";
const newer = "0.1.12-nightly.20261125.91216";

it.layer(NodeServices.layer)("t3-swap and the devbox's version", (it) => {
  const setup = Effect.fn(function* (staged: string, devbox: string | null) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-fork-swap-" });
    const home = path.join(root, "home");
    const stagedApp = path.join(home, ".local/share/t3-fork/staged/T3 Code (Terminal).app");
    yield* fs.makeDirectory(path.join(stagedApp, "Contents"), { recursive: true });
    yield* fs.writeFileString(
      path.join(stagedApp, "Contents", "Info.plist"),
      `<plist><dict><key>CFBundleShortVersionString</key><string>${staged}</string></dict></plist>\n`,
    );

    // codesign is the swap's first step after the check. Its stub records the call and stops the
    // script there, so a run that gets past the check never reaches /Applications.
    const bin = path.join(root, "bin");
    const codesignCalled = path.join(root, "codesign-called");
    yield* fs.makeDirectory(bin);
    const stub = Effect.fn(function* (name: string, body: string) {
      yield* fs.writeFileString(path.join(bin, name), `#!/bin/sh\n${body}\n`);
      yield* fs.chmod(path.join(bin, name), 0o755);
    });
    yield* stub(
      "defaults",
      `tr -d '\\n' <"$2" | sed -n 's:.*<key>CFBundleShortVersionString</key> *<string>\\([^<]*\\)</string>.*:\\1:p'`,
    );
    yield* stub("codesign", `touch '${codesignCalled}'\nexit 1`);

    const devboxDir = path.join(root, "devbox");
    if (devbox !== null) {
      yield* fs.makeDirectory(path.join(devboxDir, ".well-known", "t3"), { recursive: true });
      yield* fs.writeFileString(
        path.join(devboxDir, ".well-known", "t3", "environment"),
        JSON.stringify({ environmentId: "test", serverVersion: devbox }),
      );
    }

    const swap = (...args: ReadonlyArray<string>) =>
      Effect.sync(() => {
        const result = NodeChildProcess.spawnSync("bash", [swapScript, ...args], {
          env: {
            HOME: home,
            PATH: `${bin}:/usr/bin:/bin`,
            T3_DEVBOX_URL: `file://${devboxDir}`,
          },
          encoding: "utf8",
        });
        return { status: result.status, output: `${result.stdout}${result.stderr}` };
      });
    return {
      swap,
      swapped: fs.exists(codesignCalled),
      stagedKept: fs.exists(stagedApp),
    };
  });

  it.effect("refuses a build newer than the devbox serves", () =>
    Effect.gen(function* () {
      const { swap, swapped, stagedKept } = yield* setup(newer, served);

      const { status, output } = yield* swap();

      assert.strictEqual(status, 1);
      assert.include(output, `The devbox serves ${served}`);
      assert.include(output, "Nothing changed.");
      assert.isFalse(yield* swapped);
      assert.isTrue(yield* stagedKept);
    }),
  );

  it.effect("swaps in a build the devbox already serves", () =>
    Effect.gen(function* () {
      const { swap, swapped } = yield* setup(served, served);

      yield* swap();

      assert.isTrue(yield* swapped);
    }),
  );

  it.effect("swaps in a build older than the devbox serves", () =>
    Effect.gen(function* () {
      const { swap, swapped } = yield* setup(served, newer);

      yield* swap();

      assert.isTrue(yield* swapped);
    }),
  );

  it.effect("refuses when it cannot read the devbox's version", () =>
    Effect.gen(function* () {
      const { swap, swapped } = yield* setup(served, null);

      const { status, output } = yield* swap();

      assert.strictEqual(status, 1);
      assert.include(output, "Could not read the devbox's server version");
      assert.isFalse(yield* swapped);
    }),
  );

  it.effect("--force swaps a build newer than the devbox serves", () =>
    Effect.gen(function* () {
      const { swap, swapped } = yield* setup(newer, served);

      yield* swap("--force");

      assert.isTrue(yield* swapped);
    }),
  );

  it.effect("--force before --rollback still rolls back", () =>
    Effect.gen(function* () {
      const { swap } = yield* setup(newer, served);

      const { output } = yield* swap("--force", "--rollback");

      // Nothing is kept as previous here, so a real rollback stops at the missing build.
      assert.include(output, "previous/T3 Code (Terminal).app is missing");
    }),
  );
});
