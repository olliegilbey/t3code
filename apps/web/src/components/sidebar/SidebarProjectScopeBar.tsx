import { useGT } from "gt-react";
import { XIcon } from "lucide-react";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";

/** Names the projects the sidebar is scoped to, with a way back to all projects. */
export function SidebarProjectScopeBar(props: {
  projects: readonly SidebarProjectSnapshot[];
  // 1-based place in the swipe order, when the scope was reached by swiping.
  position: { index: number; count: number } | null;
  onReset: () => void;
}) {
  const { projects, position, onReset } = props;
  const gt = useGT();
  return (
    <div className="mt-1 flex h-8 items-center gap-2 rounded-md bg-sidebar-row-hover px-2 text-sm">
      <span className="flex shrink-0">
        {projects.slice(0, 2).map((project, index) => (
          <span
            key={project.projectKey}
            className={index === 0 ? "flex" : "-ml-1 flex rounded-[25%] ring-2 ring-sidebar"}
          >
            <ProjectFavicon project={project} className="size-4" />
          </span>
        ))}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-sidebar-foreground">
        {projects.map((project) => project.displayName).join(", ")}
      </span>
      {position ? (
        <span className="shrink-0 text-xs tabular-nums text-sidebar-muted-foreground">
          {position.index}/{position.count}
        </span>
      ) : null}
      <Button
        type="button"
        size="icon-micro"
        variant="ghost-muted"
        className="shrink-0"
        aria-label={gt("Show all projects")}
        title={gt("Show all projects")}
        onClick={onReset}
      >
        <XIcon className="size-3" />
      </Button>
    </div>
  );
}
