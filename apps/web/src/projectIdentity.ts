import { PROJECT_ICON_COLORS } from "./projectIconColors";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ProjectIconColor } from "@t3tools/contracts";
import { projectMonogram } from "@t3tools/shared/projectMonogram";

export interface ProjectIdentity {
  readonly monogram: string;
  readonly color: ProjectIconColor;
}

function normalizeProjectName(projectName: string): string {
  return projectName.normalize("NFKC").trim();
}

function projectColor(projectName: string): ProjectIconColor {
  const seed = normalizeProjectName(projectName).toLocaleLowerCase("en-US") || "project";
  let index = 0;
  for (const glyph of seed) {
    index = (index * 31 + (glyph.codePointAt(0) ?? 0)) % PROJECT_ICON_COLORS.length;
  }
  return PROJECT_ICON_COLORS[index]?.value ?? "blue";
}

export function deriveProjectIdentity(projectName: string): ProjectIdentity {
  return {
    monogram: projectMonogram(projectName),
    color: projectColor(projectName),
  };
}

/** The color the project's icon shows: the one the user picked, else its monogram's. */
export function resolveProjectColor(
  project: Pick<EnvironmentProject, "title" | "projectIcon">,
): ProjectIconColor {
  const icon = project.projectIcon;
  return (icon && "color" in icon ? icon.color : undefined) ?? projectColor(project.title);
}
