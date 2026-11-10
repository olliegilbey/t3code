import { describe, expect, it } from "vite-plus/test";

import { guessCodeFenceLanguage, tokenizeShellCommandForDisplay } from "./ShellCommandText.logic";

function kinds(command: string) {
  return tokenizeShellCommandForDisplay(command)
    .filter((token) => token.kind !== null)
    .map((token) => `${token.kind}:${token.text}`);
}

describe("tokenizeShellCommandForDisplay", () => {
  it.each([
    ["git push --force", ["command:git", "flag:--force"]],
    [
      "FOO=1 sudo vp test run 2>&1 | grep -c 'ok'",
      [
        "variable:FOO=1",
        "keyword:sudo",
        "command:vp",
        "operator:2>&1",
        "operator:|",
        "command:grep",
        "flag:-c",
        "string:'ok'",
      ],
    ],
    [
      'cd "$HOME" && echo $(date) done # note',
      [
        "command:cd",
        'string:"$HOME"',
        "operator:&&",
        "command:echo",
        "operator:$(",
        "command:date",
        "operator:)",
        "comment:# note",
      ],
    ],
    ["cat > out.txt\nls -la", ["command:cat", "operator:>", "command:ls", "flag:-la"]],
    ["git log \\\n  --oneline", ["command:git", "flag:--oneline"]],
    ["echo a#b ${X}", ["command:echo", "variable:${X}"]],
  ])("tags %j", (command, expected) => {
    expect(kinds(command)).toEqual(expected);
  });

  it("keeps every character, even past the highlighting limit or unbalanced", () => {
    for (const command of ['echo "open', "x".repeat(2100) + " | wc", "end \\"]) {
      const tokens = tokenizeShellCommandForDisplay(command);
      expect(tokens.map((token) => token.text).join("")).toBe(command);
    }
  });
});

describe("guessCodeFenceLanguage", () => {
  it.each([
    ["$ vp test run\n✓ 12 passed", "bash"],
    ["git status\ngit diff", "bash"],
    ["sudo apt-get install jq", "bash"],
    ['{\n  "name": "t3"\n}', "json"],
    ["[1, 2, 3]", "json"],
    ["diff --git a/x b/x\n--- a/x", "diff"],
    ["@@ -1,2 +1,2 @@\n-a\n+b", "diff"],
    ["Hey team, the report ships on Monday.", null],
    ["gitignore entries", null],
    ["[x] done", null],
  ])("guesses %j as %s", (code, expected) => {
    expect(guessCodeFenceLanguage(code)).toBe(expected);
  });
});
