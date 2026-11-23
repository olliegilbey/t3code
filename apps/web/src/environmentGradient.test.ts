import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  environmentGradientProps,
  orderEnvironmentIds,
  resolveEnvironmentGradient,
} from "./environmentGradient";

const ids = ["remote-a", "local", "remote-b", "remote-c", "remote-d"].map((id) =>
  EnvironmentId.make(id),
);
const [remoteA, local, remoteB, remoteC] = ids as [
  EnvironmentId,
  EnvironmentId,
  EnvironmentId,
  EnvironmentId,
];
const ordered = orderEnvironmentIds(ids, local);

const resolve = (environmentId: EnvironmentId) =>
  resolveEnvironmentGradient({ environmentId, orderedEnvironmentIds: ordered, saved: null });

describe("environment gradients", () => {
  it("gives the local environment teal and the next one indigo", () => {
    expect(ordered[0]).toBe(local);
    expect(resolve(local)).toEqual({ kind: "preset", top: "#0b2430", bottom: "#000000" });
    expect(resolve(remoteA)).toEqual({ kind: "preset", top: "#1e1834", bottom: "#000000" });
  });

  it("cycles later environments through theme colors", () => {
    expect(resolve(remoteB)).toMatchObject({ kind: "theme", top: "var(--primary)" });
    expect(resolve(remoteC)).toMatchObject({ kind: "theme", top: "var(--success)" });
    const sixth = resolveEnvironmentGradient({
      environmentId: EnvironmentId.make("unlisted"),
      orderedEnvironmentIds: [...ordered, ...ordered.slice(0, 2)],
      saved: null,
    });
    expect(sixth).toMatchObject({ kind: "theme", top: "var(--primary)" });
  });

  it("paints a saved gradient as set, and defaults from their source color", () => {
    const saved = { top: "#123456", bottom: "#abcdef" };
    const custom = resolveEnvironmentGradient({
      environmentId: local,
      orderedEnvironmentIds: ordered,
      saved,
    });
    expect(environmentGradientProps(custom)).toEqual({
      "data-environment-gradient": "custom",
      style: {
        "--environment-gradient-top": "#123456",
        "--environment-gradient-bottom": "#abcdef",
      },
    });
    expect(environmentGradientProps(resolve(remoteB))).toEqual({
      "data-environment-gradient": "theme",
      style: { "--environment-gradient-source": "var(--primary)" },
    });
  });
});
