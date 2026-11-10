import { tokenizeShellCommandForDisplay } from "./ShellCommandText.logic";

/** A command split into tagged spans. Only Terminal mode's stylesheet colors them. */
export function ShellCommandText({ command }: { command: string }) {
  return tokenizeShellCommandForDisplay(command).map((token, index) =>
    token.kind === null ? (
      token.text
    ) : (
      // Tokens never reorder, so the index is a stable key.
      // oxlint-disable-next-line react/no-array-index-key
      <span key={index} data-shell-token={token.kind}>
        {token.text}
      </span>
    ),
  );
}
