import type { ReactNode } from "react";

import { formatContextWindowTokens, type ContextWindowSnapshot } from "~/lib/contextWindow";
import { useTerminalMode, useVimKeys } from "../../terminalMode";

/**
 * Terminal mode's vim-style statusline under the composer: the vim mode, whether the
 * agent works, the composer's context strip (or just the branch), then context. Outside
 * Terminal mode it renders the strip as it was. CSS reads the mode off the editor.
 */
export function TerminalStatusline(props: {
  readonly working: boolean;
  readonly branch: string | null;
  readonly context: ContextWindowSnapshot | null;
  readonly children?: ReactNode;
}) {
  const terminalMode = useTerminalMode();
  const vimKeys = useVimKeys();
  if (!terminalMode) return props.children;
  const { context } = props;
  const percent = context?.usedPercentage != null ? `${Math.round(context.usedPercentage)}%` : null;
  return (
    <div data-terminal-statusline="">
      {vimKeys ? <span data-statusline-mode="vim" /> : null}
      {props.working ? <span data-statusline-mode="agent">AGENT</span> : null}
      {props.children ? (
        <div data-statusline-git="">{props.children}</div>
      ) : (
        <>
          {props.branch ? <span data-statusline-branch="">{props.branch}</span> : null}
          <span data-statusline-fill="" />
        </>
      )}
      {context ? (
        <span data-statusline-context="">
          {percent ? `${percent} ` : null}
          {formatContextWindowTokens(context.usedTokens)}
          {context.maxTokens ? `/${formatContextWindowTokens(context.maxTokens)}` : null}
        </span>
      ) : null}
    </div>
  );
}
