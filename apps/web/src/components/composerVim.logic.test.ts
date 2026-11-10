import { describe, expect, it } from "vite-plus/test";

import {
  clampToLine,
  lineAt,
  lineDeletionRange,
  motionTarget,
  operatorRange,
  type VimMotion,
} from "./composerVim.logic";

// `|` marks the caret in each case and is removed before the call.
function caret(marked: string): { text: string; at: number } {
  return { text: marked.replace("|", ""), at: marked.indexOf("|") };
}

describe("motionTarget", () => {
  it.each<[VimMotion, string, number | null]>([
    ["w", "|git push origin", 4],
    ["w", "git| push", 4],
    ["w", "|foo.bar", 3],
    ["w", "foo|.bar", 4],
    ["w", "one\n|two three", 8],
    ["w", "last |word", null],
    ["e", "|git push", 2],
    ["e", "gi|t push", 7],
    ["e", "done|", null],
    ["b", "git push|", 4],
    ["b", "git |push", 0],
    ["b", "  |x", null],
    ["h", "ab\n|cd", 3],
    ["l", "a|b\ncd", 1],
    ["0", "ab\ncd|e", 3],
    ["^", "x\n   in|dented", 5],
    ["$", "|ab\ncd", 1],
    ["$", "ab\n|\ncd", 3],
  ])("%s from %j lands at %j", (motion, marked, expected) => {
    const { text, at } = caret(marked);
    expect(motionTarget(text, at, motion)).toBe(expected);
  });
});

describe("operatorRange", () => {
  it.each<["d" | "c", VimMotion, string, string | null]>([
    ["d", "w", "|git push", "git "],
    ["c", "w", "|git push", "git"],
    ["c", "w", "g|it push", "it"],
    ["d", "w", "one |two\nthree", "two"],
    ["d", "e", "|git push", "git"],
    ["d", "b", "git pu|sh", "pu"],
    ["d", "b", "one\n|two", null],
    ["d", "$", "ab|cd\nef", "cd"],
    ["d", "0", "ab\ncd|ef", "cd"],
    ["d", "^", "  |ab", null],
    ["d", "l", "a|b", "b"],
    ["d", "h", "a|b", "a"],
  ])("%s%s on %j removes %j", (operator, motion, marked, removed) => {
    const { text, at } = caret(marked);
    const range = operatorRange(text, at, operator, motion);
    expect(range ? text.slice(range.from, range.to) : null).toBe(removed);
  });
});

describe("lines", () => {
  it.each<[string, string | null]>([
    ["a|b", null],
    ["one\nt|wo\nthree", "two\n"],
    ["one\nt|wo", "\ntwo"],
    ["|\nb", "\n"],
  ])("dd on %j removes %j", (marked, removed) => {
    const { text, at } = caret(marked);
    const range = lineDeletionRange(text, at);
    expect(range ? text.slice(range.from, range.to) : null).toBe(removed);
  });

  it("finds a line when the caret sits on its newline or at a block's start", () => {
    expect(lineAt("ab\ncd", 2)).toEqual({ from: 0, to: 2 });
    expect(lineAt("\nab", 0)).toEqual({ from: 0, to: 0 });
  });

  it("keeps the caret on a character, unless the line is empty", () => {
    expect(clampToLine("ab\ncd", 2)).toBe(1);
    expect(clampToLine("ab\n\ncd", 3)).toBe(3);
  });
});
