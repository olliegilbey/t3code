import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";

import { createBuildConfig } from "./build-desktop-artifact.ts";

const macBuildConfig = (env: Record<string, string>) =>
  createBuildConfig(
    "mac",
    "dir",
    "0.1.5-nightly.20261030.92340",
    false,
    false,
    undefined,
    undefined,
  ).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))));

it.layer(NodeServices.layer)("build-desktop-artifact app ID", (it) => {
  it.effect("takes the app ID from T3CODE_DESKTOP_APP_ID, so a fork build is its own app", () =>
    Effect.gen(function* () {
      const fork = yield* macBuildConfig({ T3CODE_DESKTOP_APP_ID: "gg.ollie.t3code.terminal" });
      const official = yield* macBuildConfig({});

      assert.equal(fork.appId, "gg.ollie.t3code.terminal");
      assert.equal(official.appId, "com.t3tools.t3code");
    }),
  );
});
