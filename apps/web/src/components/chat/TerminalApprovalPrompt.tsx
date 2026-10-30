import {
  FULL_ACCESS_OVERRIDE_QUESTION,
  fullAccessOverrideExplanation,
} from "@t3tools/client-runtime/state/thread-requests";
import type { ProviderApprovalDecision, ProviderApprovalOption } from "@t3tools/contracts";
import { memo } from "react";
import type { PendingApproval } from "../../session-logic";
import { InlineButton } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { composerFloatingLayerProps } from "./composerEventScope";
import type { TerminalApprovalState } from "./terminalApproval.logic";

const TITLES = {
  command: "Run command?",
  "file-change": "Change files?",
  "file-read": "Read file?",
  permission: "Allow permission?",
  "mcp-elicitation": "Allow app access?",
} satisfies Record<PendingApproval["requestKind"], string>;

function resultLine(decision: ProviderApprovalDecision) {
  if (decision === "decline") return { tone: "declined", text: "✗ Declined" };
  if (decision === "cancel") return { tone: "declined", text: "✗ Cancelled" };
  return { tone: "approved", text: "✓ Approved" };
}

export const TerminalApprovalPrompt = memo(function TerminalApprovalPrompt({
  approval,
  position,
  options,
  state,
  flashIndex,
  result,
  disabled,
  onRun,
}: {
  approval: PendingApproval;
  position: { index: number; total: number };
  options: ReadonlyArray<ProviderApprovalOption>;
  state: TerminalApprovalState;
  flashIndex: number | null;
  result: ProviderApprovalDecision | null;
  disabled: boolean;
  onRun: (index: number) => void;
}) {
  const canRespond = approval.responseCapability === "live";
  const shownResult = result ? resultLine(result) : null;
  return (
    <div
      data-terminal-approval-prompt
      className="flex flex-col gap-1.5 px-3 pt-2 pb-1.5 font-mono text-xs/5"
    >
      <div className="flex items-baseline gap-2">
        <span data-terminal-approval-title className="font-bold">
          {TITLES[approval.requestKind]}
        </span>
        {approval.appName ? (
          <span className="min-w-0 truncate text-muted-foreground">{approval.appName}</span>
        ) : null}
        {position.total > 1 ? (
          <span className="ms-auto shrink-0 text-muted-foreground">
            {position.index + 1} of {position.total}
          </span>
        ) : null}
      </div>
      <code
        data-terminal-approval-detail
        className="block max-h-40 overflow-auto whitespace-pre-wrap wrap-anywhere select-text [scrollbar-width:thin]"
      >
        {approval.requestKind === "command" ? "$ " : null}
        {approval.detail || TITLES[approval.requestKind]}
      </code>
      {approval.reason ? (
        <span className="text-muted-foreground select-text wrap-anywhere">{approval.reason}</span>
      ) : null}
      {shownResult ? (
        <div data-terminal-approval-result={shownResult.tone} role="status">
          {shownResult.text}
        </div>
      ) : canRespond ? (
        <div role="listbox" aria-label="Approval options" className="flex flex-col">
          {options.map((option, index) => {
            const selected = index === state.selected;
            return (
              <button
                key={option.decision}
                type="button"
                role="option"
                aria-selected={selected}
                aria-description={option.warning}
                disabled={disabled}
                data-terminal-approval-option
                data-selected={selected ? "" : undefined}
                data-flash={flashIndex === index ? "" : undefined}
                className="flex w-full items-baseline gap-1 text-left"
                // The composer keeps focus, so its keys still answer the prompt.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onRun(index)}
              >
                <span aria-hidden className="w-[2ch] shrink-0">
                  {selected ? "❯" : ""}
                </span>
                <span className="shrink-0">{index + 1}.</span>
                <span className="min-w-0 wrap-anywhere">{option.label}</span>
                {flashIndex === index ? <span aria-label="Answering">…</span> : null}
                {state.reasonFor === option.decision ? (
                  <span data-terminal-approval-reason className="shrink-0">
                    + reason
                  </span>
                ) : null}
                {option.warning ? (
                  <span className="min-w-0 truncate text-muted-foreground">{option.warning}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : (
        <span data-terminal-approval-result="declined">
          Provider process is gone. Interrupt or restart the run to respond.
        </span>
      )}
      <div className="flex flex-wrap items-baseline gap-x-3 text-muted-foreground">
        {canRespond && !shownResult ? (
          <span>Enter to run · ↑↓ or j/k to choose · Tab to add a reason</span>
        ) : null}
        {approval.fullAccessOverride ? (
          <Popover>
            <PopoverTrigger openOnHover render={<InlineButton tone="muted" />}>
              {FULL_ACCESS_OVERRIDE_QUESTION}
            </PopoverTrigger>
            <PopoverPopup
              {...composerFloatingLayerProps}
              aria-label={FULL_ACCESS_OVERRIDE_QUESTION}
              tooltipStyle
              side="top"
              className="max-w-[min(22rem,calc(100vw-2rem))] whitespace-normal"
            >
              {fullAccessOverrideExplanation(approval.fullAccessOverride)}
            </PopoverPopup>
          </Popover>
        ) : null}
      </div>
    </div>
  );
});
