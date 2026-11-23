import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";

import {
  environmentGradientProps,
  orderEnvironmentIds,
  resolveEnvironmentGradient,
} from "../environmentGradient";
import { environmentPresentations } from "../state/presentation";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { serverEnvironment } from "../state/server";
import { useClientSettings } from "./useSettings";

/** Environments in the order their default gradients are handed out on this device. */
export function useOrderedEnvironmentIds(): ReadonlyArray<EnvironmentId> {
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  return orderEnvironmentIds([...presentations.keys()], primaryEnvironmentId);
}

/** Props for a surface tinted by its environment, or null while the setting is off. */
export function useEnvironmentGradientSurface(environmentId: EnvironmentId) {
  const enabled = useClientSettings((settings) => settings.environmentGradients);
  const orderedEnvironmentIds = useOrderedEnvironmentIds();
  const saved =
    useAtomValue(serverEnvironment.settingsValueAtom(environmentId))?.environmentGradient ?? null;
  if (!enabled) return null;
  return environmentGradientProps(
    resolveEnvironmentGradient({ environmentId, orderedEnvironmentIds, saved }),
  );
}
