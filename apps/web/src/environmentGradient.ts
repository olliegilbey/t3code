import type { EnvironmentGradient, EnvironmentId } from "@t3tools/contracts";
import type { CSSProperties } from "react";

/** The first two environments' defaults: dark teal, then dark indigo, both fading to black. */
const ENVIRONMENT_GRADIENT_PRESETS: ReadonlyArray<EnvironmentGradient> = [
  { top: "#0b2430", bottom: "#000000" },
  { top: "#1e1834", bottom: "#000000" },
];

/** Later environments take these theme colors in turn, at the presets' darkness. */
const THEME_SOURCES = ["--primary", "--success", "--warning", "--destructive", "--info"] as const;

export type EnvironmentGradientKind = "custom" | "preset" | "theme";

export interface ResolvedEnvironmentGradient {
  readonly kind: EnvironmentGradientKind;
  /** A theme color is a `var()`; presets and saved gradients are hex. */
  readonly top: string;
  readonly bottom: string;
}

/** The local environment comes first, then the rest in their saved order. */
export function orderEnvironmentIds(
  environmentIds: ReadonlyArray<EnvironmentId>,
  primaryEnvironmentId: EnvironmentId | null,
): ReadonlyArray<EnvironmentId> {
  if (primaryEnvironmentId === null || !environmentIds.includes(primaryEnvironmentId)) {
    return environmentIds;
  }
  return [primaryEnvironmentId, ...environmentIds.filter((id) => id !== primaryEnvironmentId)];
}

export function resolveEnvironmentGradient(input: {
  readonly environmentId: EnvironmentId;
  readonly orderedEnvironmentIds: ReadonlyArray<EnvironmentId>;
  readonly saved: EnvironmentGradient | null;
}): ResolvedEnvironmentGradient {
  if (input.saved !== null) return { kind: "custom", ...input.saved };
  const found = input.orderedEnvironmentIds.indexOf(input.environmentId);
  const position = found === -1 ? input.orderedEnvironmentIds.length : found;
  const preset = ENVIRONMENT_GRADIENT_PRESETS[position];
  if (preset !== undefined) return { kind: "preset", ...preset };
  const source =
    THEME_SOURCES[(position - ENVIRONMENT_GRADIENT_PRESETS.length) % THEME_SOURCES.length];
  return { kind: "theme", top: `var(${source})`, bottom: "#000000" };
}

/**
 * Props for an element painted with the gradient. Defaults pass their source color and let
 * environment-gradient.css fit it to the appearance; a saved gradient is painted as set.
 */
export function environmentGradientProps(gradient: ResolvedEnvironmentGradient): {
  readonly "data-environment-gradient": EnvironmentGradientKind;
  readonly style: CSSProperties;
} {
  const style =
    gradient.kind === "custom"
      ? {
          "--environment-gradient-top": gradient.top,
          "--environment-gradient-bottom": gradient.bottom,
        }
      : { "--environment-gradient-source": gradient.top };
  return { "data-environment-gradient": gradient.kind, style: style as CSSProperties };
}
