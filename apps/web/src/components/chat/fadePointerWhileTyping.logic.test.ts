import { describe, expect, it } from "vite-plus/test";

import { isTypingKeyDown } from "./fadePointerWhileTyping";

const key = (key: string, modifiers: { metaKey?: boolean; ctrlKey?: boolean } = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  isComposing: false,
  ...modifiers,
});

describe("isTypingKeyDown", () => {
  it.each([
    [key("a"), true],
    [key("é"), true],
    [key(" "), true],
    [key("Backspace"), true],
    [key("Enter"), true],
    [{ ...key("Process"), isComposing: true }, true],
    [key("k", { metaKey: true }), false],
    [key("c", { ctrlKey: true }), false],
    [key("Shift"), false],
    [key("ArrowLeft"), false],
    [key("Escape"), false],
  ])("%o -> %s", (event, expected) => {
    expect(isTypingKeyDown(event)).toBe(expected);
  });
});
