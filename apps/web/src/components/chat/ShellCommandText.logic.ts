export type ShellTokenKind =
  | "command"
  | "keyword"
  | "flag"
  | "string"
  | "variable"
  | "operator"
  | "comment";

export interface ShellToken {
  readonly text: string;
  readonly kind: ShellTokenKind | null;
}

// Highlighting stops here; a row shows one truncated line, so the rest stays plain.
const MAX_HIGHLIGHTED_LENGTH = 2000;

// One alternation, tried in order at each offset. Groups: space, comment, string,
// variable, operator, then a word, which may hold escapes and a bare `$`.
const SHELL_TOKEN =
  /(\s+)|((?<=^|\s)#.*)|('[^']*'?|\$?"(?:[^"\\]|\\[\s\S])*"?|\$'(?:[^'\\]|\\[\s\S])*'?)|(\$\{[^}]*\}?|\$[A-Za-z_]\w*|\$[\d@#?$!*-])|(\$\(|&&|\|\||;;|[|;&()]|\d*[<>]+&?\d*)|((?:[^\s'"$|;&<>()\\]|\\[\s\S]|\$(?![({\w@#?$!*-]))+)/y;

// Words after which the next word is still a command, such as `sudo git push`.
const PREFIX_WORDS = new Set([
  "sudo",
  "env",
  "time",
  "nohup",
  "exec",
  "command",
  "builtin",
  "nice",
  "then",
  "else",
  "do",
  "if",
  "elif",
  "while",
  "until",
  "!",
]);
const KEYWORDS = new Set([
  ...PREFIX_WORDS,
  "fi",
  "done",
  "for",
  "case",
  "esac",
  "function",
  "return",
]);
const ASSIGNMENT = /^[A-Za-z_]\w*=/;

/** Splits a shell command into display tokens. Joining every token's text returns the input. */
export function tokenizeShellCommandForDisplay(command: string): ShellToken[] {
  const source = command.slice(0, MAX_HIGHLIGHTED_LENGTH);
  const tokens: ShellToken[] = [];
  let commandPosition = true;
  let offset = 0;
  while (offset < source.length) {
    SHELL_TOKEN.lastIndex = offset;
    const match = SHELL_TOKEN.exec(source);
    if (!match) {
      // An unmatched character, such as a lone backslash at the end.
      tokens.push({ text: source[offset]!, kind: null });
      offset += 1;
      continue;
    }
    const [text, space, comment, string, variable, operator] = match;
    offset += text.length;
    if (space !== undefined) {
      tokens.push({ text, kind: null });
      if (text.includes("\n")) commandPosition = true;
    } else if (comment !== undefined) {
      tokens.push({ text, kind: "comment" });
    } else if (string !== undefined) {
      tokens.push({ text, kind: "string" });
      commandPosition = false;
    } else if (variable !== undefined) {
      tokens.push({ text, kind: "variable" });
      commandPosition = false;
    } else if (operator !== undefined) {
      tokens.push({ text, kind: "operator" });
      // A redirect's target is a file, and a closing paren ends a command.
      commandPosition = !/[<>)]/.test(text);
    } else if (commandPosition && ASSIGNMENT.test(text)) {
      tokens.push({ text, kind: "variable" });
    } else if (commandPosition && KEYWORDS.has(text)) {
      tokens.push({ text, kind: "keyword" });
      commandPosition = PREFIX_WORDS.has(text);
    } else if (commandPosition) {
      tokens.push({ text, kind: "command" });
      commandPosition = false;
    } else {
      tokens.push({ text, kind: text.startsWith("-") ? "flag" : null });
    }
  }
  if (source.length < command.length)
    tokens.push({ text: command.slice(source.length), kind: null });
  return tokens;
}

const SHELL_PROMPT_LINE = /^\s*[$❯] \S/;
const SHELL_COMMAND_LINE =
  /^\s*(?:sudo\s+)?(?:git|gh|npm|npx|pnpm|yarn|bunx?|vpr?|node|deno|python3?|pip3?|uvx?|cargo|go|make|docker|kubectl|helm|brew|apt(?:-get)?|curl|wget|cd|ls|cat|echo|export|mkdir|rm|cp|mv|ssh|scp|rsync|tailscale|systemctl|journalctl|grep|rg|find|sed|awk|chmod|tar|terraform|aws|gcloud|psql|sqlite3|t3)(?=\s|$)/;
const JSON_START = /^\s*(?:\{\s*(?:"|\}|$)|\[\s*(?:[{["\d\]-]|true\b|false\b|null\b|$))/;
const DIFF_START = /^(?:diff --git |--- \S|@@ )/;

/**
 * A language for a fence that names none, from its first line alone so a streaming
 * block costs the same as a finished one. Null keeps it plain text.
 */
export function guessCodeFenceLanguage(code: string): string | null {
  const head = code.slice(0, 400);
  const firstLine = head.split("\n").find((line) => line.trim()) ?? "";
  if (DIFF_START.test(firstLine)) return "diff";
  if (JSON_START.test(head)) return "json";
  if (SHELL_PROMPT_LINE.test(firstLine) || SHELL_COMMAND_LINE.test(firstLine)) return "bash";
  return null;
}
