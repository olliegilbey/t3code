import { RuntimeRequestId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { TerminalApprovalPrompt } from "./TerminalApprovalPrompt";
import { orderApprovalOptions } from "./terminalApproval.logic";

it("hands the keyboard back on a click, but keeps a selection made to copy the command", async () => {
  const onFocusComposer = vi.fn();
  const onRun = vi.fn();
  await using screen = await render(
    <TerminalApprovalPrompt
      approval={{
        requestId: RuntimeRequestId.make("a"),
        requestKind: "command",
        createdAt: "2026-10-30T00:00:00.000Z",
        detail: "rm -rf build",
        responseCapability: "live",
      }}
      source={null}
      position={{ index: 0, total: 1 }}
      options={orderApprovalOptions(undefined)}
      state={{ selected: 0, reasonFor: null }}
      flashIndex={null}
      result={null}
      hint="Enter to run"
      disabled={false}
      onRun={onRun}
      onFocusComposer={onFocusComposer}
    />,
    { router: false },
  );

  await userEvent.click(screen.getByText("Run command?"));
  expect(onFocusComposer).toHaveBeenCalledTimes(1);

  await userEvent.click(screen.getByRole("option").first());
  expect(onRun).toHaveBeenCalledWith(0);
  expect(onFocusComposer).toHaveBeenCalledTimes(2);

  const detail = screen.container.querySelector("[data-terminal-approval-detail]")!;
  window.getSelection()?.selectAllChildren(detail);
  detail.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(onFocusComposer).toHaveBeenCalledTimes(2);
  expect(window.getSelection()?.toString()).toContain("rm -rf build");
});
