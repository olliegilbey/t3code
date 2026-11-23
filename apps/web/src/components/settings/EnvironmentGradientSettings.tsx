import {
  AuthSettingsWriteScope,
  resolveEnvironmentMachineKind,
  type EnvironmentGradient,
  type EnvironmentId,
} from "@t3tools/contracts";
import type { EnvironmentServerConfig } from "@t3tools/client-runtime/connection";
import { useGT } from "gt-react";
import { useRef, useState } from "react";

import { environmentGradientProps, resolveEnvironmentGradient } from "../../environmentGradient";
import { useOrderedEnvironmentIds } from "../../hooks/useEnvironmentGradient";
import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentScope } from "../../state/session";
import { themeColorToHex } from "../../themePalette";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { ThemeColorPicker } from "./ThemeColorPicker";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

type Edge = keyof EnvironmentGradient;

export function EnvironmentGradientSettings() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const enabled = useScopedSettings((settings) => settings.environmentGradients);
  const updateSettings = useUpdateScopedSettings();
  const { environments } = useEnvironments();
  const orderedEnvironmentIds = useOrderedEnvironmentIds();
  const environmentById = new Map(environments.map((entry) => [entry.environmentId, entry]));

  return (
    <SettingsRow
      {...searchableSetting("environment-gradients")}
      description={gt(
        "Tint each conversation by the environment it runs on. Colors are saved on each environment, so every device shows them. Until you pick some, environments take teal, then indigo, then your theme's colors.",
      )}
      resetAction={
        enabled ? (
          <SettingResetButton
            ariaLabel={gt("Reset environment gradients to default")}
            onClick={() => updateSettings({ environmentGradients: false })}
          />
        ) : null
      }
      control={
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => updateSettings({ environmentGradients: Boolean(checked) })}
          aria-label={gt("Environment gradients")}
        />
      }
    >
      {enabled ? (
        <div className="grid gap-1 pt-2 pb-2">
          {orderedEnvironmentIds.flatMap((environmentId) => {
            const environment = environmentById.get(environmentId);
            return environment
              ? [
                  <EnvironmentGradientRow
                    key={environmentId}
                    environmentId={environmentId}
                    label={environment.label}
                    serverConfig={environment.serverConfig}
                    orderedEnvironmentIds={orderedEnvironmentIds}
                  />,
                ]
              : [];
          })}
        </div>
      ) : null}
    </SettingsRow>
  );
}

function EnvironmentGradientRow(props: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly serverConfig: EnvironmentServerConfig | null;
  readonly orderedEnvironmentIds: ReadonlyArray<EnvironmentId>;
}) {
  const gt = useGT();
  const rowRef = useRef<HTMLDivElement>(null);
  const updateSettings = useUpdateEnvironmentSettings(props.environmentId);
  const canWrite = useEnvironmentScope(props.environmentId, AuthSettingsWriteScope);
  const saved = props.serverConfig?.settings.environmentGradient ?? null;
  // A draft shows the colors being picked until the saved value changes under it.
  const [draft, setDraft] = useState<{
    readonly gradient: EnvironmentGradient;
    readonly base: EnvironmentGradient | null;
  } | null>(null);
  if (draft !== null && draft.base !== saved) setDraft(null);
  const gradient = resolveEnvironmentGradient({
    environmentId: props.environmentId,
    orderedEnvironmentIds: props.orderedEnvironmentIds,
    saved: draft?.gradient ?? saved,
  });

  const lock =
    props.serverConfig === null
      ? gt("Connect to this environment to change its gradient.")
      : props.serverConfig.environment.capabilities.environmentGradient !== true
        ? gt("Update this environment to change its gradient.")
        : !canWrite
          ? gt("Your session on this environment cannot change its settings.")
          : null;

  // Defaults are fitted to the theme in CSS, so the pickers start from the colors on screen.
  const shownColors = (): EnvironmentGradient => {
    const style = rowRef.current ? getComputedStyle(rowRef.current) : null;
    const read = (edge: Edge) =>
      (
        themeColorToHex(style?.getPropertyValue(`--environment-gradient-${edge}`) ?? "") ??
        "#000000"
      ).slice(0, 7);
    return { top: read("top"), bottom: read("bottom") };
  };
  // The pickers commit on close, after their last frame has landed, so the edit lives in a ref.
  const editing = useRef<{ colors: EnvironmentGradient; changed: boolean } | null>(null);
  const endEdit = (save: boolean) => {
    const edit = editing.current;
    editing.current = null;
    if (save && edit?.changed) updateSettings({ environmentGradient: edit.colors });
    else setDraft(null);
  };
  const picker = (edge: Edge) => {
    const label =
      edge === "top"
        ? gt("{environment} gradient top", { environment: props.label })
        : gt("{environment} gradient bottom", { environment: props.label });
    return (
      <ThemeColorPicker
        label={label}
        value={gradient.kind === "custom" ? gradient[edge] : `var(--environment-gradient-${edge})`}
        onEditStart={() => {
          const colors =
            gradient.kind === "custom"
              ? { top: gradient.top, bottom: gradient.bottom }
              : shownColors();
          editing.current = { colors, changed: false };
          setDraft({ gradient: colors, base: saved });
        }}
        onChange={(color) => {
          const edit = editing.current;
          if (edit === null) return;
          edit.colors = { ...edit.colors, [edge]: color.slice(0, 7) };
          edit.changed = true;
          setDraft({ gradient: edit.colors, base: saved });
        }}
        onEditEnd={() => endEdit(true)}
        onEditCancel={() => endEdit(false)}
      />
    );
  };

  return (
    <div
      ref={rowRef}
      {...environmentGradientProps(gradient)}
      className="flex min-h-9 items-center gap-3 rounded-md px-1"
    >
      <EnvironmentMachineIcon
        kind={resolveEnvironmentMachineKind(props.serverConfig)}
        className="size-3.5 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{props.label}</span>
      {lock !== null ? (
        <span className="min-w-0 truncate text-xs text-muted-foreground">{lock}</span>
      ) : null}
      <span
        aria-hidden
        className="h-6 w-12 shrink-0 rounded-md border border-border bg-(image:--environment-gradient)"
      />
      {lock === null ? (
        <>
          {picker("top")}
          {picker("bottom")}
          {saved !== null ? (
            <SettingResetButton
              ariaLabel={gt("Reset {environment} gradient to default", {
                environment: props.label,
              })}
              onClick={() => updateSettings({ environmentGradient: null })}
            />
          ) : (
            <span className="size-6 shrink-0" />
          )}
        </>
      ) : null}
    </div>
  );
}
