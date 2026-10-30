import { EnvironmentId, MessageId, RunId } from "@t3tools/contracts";
import type { LegendListRef } from "@legendapp/list/react";
import { createRef, type ComponentProps } from "react";
import { describe, expect, it } from "vite-plus/test";

import "~/index.css";

import { render } from "../../../test/render";
import { setTerminalModeEnabled } from "../../terminalMode";
import { MessagesTimeline } from "./MessagesTimeline";

type TimelineProps = ComponentProps<typeof MessagesTimeline>;
type Entry = TimelineProps["timelineEntries"][number];

const AT = "2026-10-30T12:00:00.000Z";
const RUN_ID = RunId.make("run-1");

function terminalMode(): Disposable {
  setTerminalModeEnabled(true);
  return { [Symbol.dispose]: () => setTerminalModeEnabled(false) };
}

function message(id: string, role: "user" | "assistant", text: string): Entry {
  return {
    id: `entry-${id}`,
    kind: "message",
    createdAt: AT,
    message: {
      id: MessageId.make(id),
      role,
      text,
      runId: role === "user" ? null : RUN_ID,
      createdAt: AT,
      updatedAt: AT,
      streaming: false,
    },
  };
}

function thought(id: string, detail: string, status = "completed"): Entry {
  return {
    id,
    kind: "work",
    createdAt: AT,
    entry: {
      id,
      runId: RUN_ID,
      createdAt: AT,
      label: "Thought",
      tone: "thinking",
      itemType: "reasoning",
      detail,
      toolLifecycleStatus: status,
    },
  } as Entry;
}

function command(id: string, text: string, status = "completed"): Entry {
  return {
    id,
    kind: "work",
    createdAt: AT,
    entry: {
      id,
      runId: RUN_ID,
      createdAt: AT,
      label: "Ran command",
      tone: "tool",
      requestKind: "command",
      command: text,
      toolLifecycleStatus: status,
    },
  } as Entry;
}

async function renderTimeline(entries: Entry[], props: Partial<TimelineProps> = {}) {
  const container = document.createElement("div");
  container.style.cssText = "height: 1200px; width: 900px; display: flex; flex-direction: column;";
  const screen = await render(
    <MessagesTimeline
      isWorking={false}
      listRef={createRef<LegendListRef | null>()}
      latestRun={null}
      turnDiffSummaries={[]}
      runs={[]}
      routeThreadKey={`environment-local:thread-${Math.random().toString(36).slice(2)}`}
      onOpenTurnDiff={() => {}}
      onOpenThread={() => {}}
      onForkFromRun={async () => {}}
      supportsConversationRollback={false}
      onRevertToTurnCount={() => {}}
      isRevertingCheckpoint={false}
      onImageExpand={() => {}}
      activeThreadEnvironmentId={EnvironmentId.make("environment-local")}
      markdownCwd={undefined}
      resolvedTheme="dark"
      timestampFormat="locale"
      workspaceRoot={undefined}
      anchorMessageId={null}
      onAnchorReady={() => {}}
      onAnchorSizeChanged={() => {}}
      contentInsetEndAdjustment={0}
      emptyPlaceholderInset={0}
      liveFollowEnabled
      onIsAtEndChange={() => {}}
      timelineEntries={entries}
      {...props}
    />,
    { container },
  );
  return Object.assign(screen, { text: () => container.textContent ?? "" });
}

describe("Terminal mode keeps thoughts folded, as the default view does", () => {
  it("shows a finished turn's tool lines but not its thoughts", async () => {
    using _mode = terminalMode();
    await using screen = await renderTimeline([
      message("ask", "user", "Fix the bug"),
      thought("thought-mixed", "Weighing the first option"),
      command("search", "rg cause"),
      message("middle", "assistant", "Looked around."),
      thought("thought-alone", "Settling on the second option"),
      message("between", "assistant", "Checking twice."),
      thought("thought-pair-1", "Checking one"),
      thought("thought-pair-2", "Checking two"),
      message("done", "assistant", "Done."),
    ]);

    await expect.element(screen.getByText("Done.")).toBeVisible();
    await expect.element(screen.getByText("rg cause")).toBeVisible();
    for (const text of [
      "Weighing the first option",
      "Settling on the second option",
      "Checking one",
      "Checking two",
    ]) {
      expect(screen.text()).not.toContain(text);
    }
  });

  it("opens a thought when it is clicked", async () => {
    using _mode = terminalMode();
    await using screen = await renderTimeline([
      message("ask", "user", "Fix the bug"),
      thought("thought-mixed", "Weighing the first option"),
      command("search", "rg cause"),
      message("done", "assistant", "Done."),
    ]);

    await screen.getByRole("button", { name: "Thought", exact: true }).click();
    await expect.element(screen.getByText("Weighing the first option")).toBeVisible();
  });

  it("previews the latest thought while the agent works", async () => {
    using _mode = terminalMode();
    await using screen = await renderTimeline(
      [
        message("ask", "user", "Fix the bug"),
        thought("thought-live", "Found the cause"),
        command("search", "rg cause", "inProgress"),
      ],
      {
        isWorking: true,
        latestRun: { runId: RUN_ID, status: "running", startedAt: AT, completedAt: null },
        activeTurnStartedAt: AT,
      },
    );

    await expect.element(screen.getByText("Found the cause")).toBeVisible();
  });
});
