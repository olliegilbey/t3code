// Vim motions over one textblock's text. Every offset is one document position:
// the caller reads inline chips as U+FFFC and hard breaks as "\n".

export type VimMotion = "h" | "l" | "w" | "b" | "e" | "0" | "^" | "$";

const MOTIONS: ReadonlySet<string> = new Set<VimMotion>(["h", "l", "w", "b", "e", "0", "^", "$"]);

export function isVimMotion(key: string): key is VimMotion {
  return MOTIONS.has(key);
}

export interface TextRange {
  readonly from: number;
  readonly to: number;
}

/** The line holding `at`, without its newline. */
export function lineAt(text: string, at: number): TextRange {
  const from = at === 0 ? 0 : text.lastIndexOf("\n", at - 1) + 1;
  const newline = text.indexOf("\n", at);
  return { from, to: newline === -1 ? text.length : newline };
}

/** Normal mode rests on a character, so the caret never sits past a line's last one. */
export function clampToLine(text: string, at: number): number {
  const line = lineAt(text, at);
  return at >= line.to && line.to > line.from ? line.to - 1 : at;
}

export function firstNonBlank(text: string, line: TextRange): number {
  let at = line.from;
  while (at < line.to && (text[at] === " " || text[at] === "\t")) at += 1;
  return at;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

// 0 is blank, 1 a word character, 2 punctuation; a run of one class is a vim word.
function charClass(char: string | undefined): 0 | 1 | 2 {
  if (char === undefined || /\s/.test(char)) return 0;
  return WORD_CHAR.test(char) ? 1 : 2;
}

function nextWordStart(text: string, at: number): number | null {
  let index = at;
  const start = charClass(text[index]);
  if (start !== 0) while (index < text.length && charClass(text[index]) === start) index += 1;
  while (index < text.length && charClass(text[index]) === 0) index += 1;
  return index < text.length ? index : null;
}

function wordEnd(text: string, at: number): number | null {
  let index = at + 1;
  while (index < text.length && charClass(text[index]) === 0) index += 1;
  if (index >= text.length) return null;
  const run = charClass(text[index]);
  while (index + 1 < text.length && charClass(text[index + 1]) === run) index += 1;
  return index;
}

function previousWordStart(text: string, at: number): number | null {
  let index = at - 1;
  while (index >= 0 && charClass(text[index]) === 0) index -= 1;
  if (index < 0) return null;
  const run = charClass(text[index]);
  while (index > 0 && charClass(text[index - 1]) === run) index -= 1;
  return index;
}

/** Where a motion lands, or null when a word motion runs off the block. */
export function motionTarget(text: string, at: number, motion: VimMotion): number | null {
  const line = lineAt(text, Math.max(at, 0));
  switch (motion) {
    case "h":
      return Math.max(line.from, at - 1);
    case "l":
      return Math.min(Math.max(line.from, line.to - 1), at + 1);
    case "0":
      return line.from;
    case "^":
      return firstNonBlank(text, line);
    case "$":
      return Math.max(line.from, line.to - 1);
    case "w":
      return nextWordStart(text, at);
    case "e":
      return wordEnd(text, at);
    case "b":
      return previousWordStart(text, at);
  }
}

/** The text `d{motion}` removes. It stays on the caret's line, and `cw` changes to the word's end. */
export function operatorRange(
  text: string,
  at: number,
  operator: "d" | "c",
  motion: VimMotion,
): TextRange | null {
  const line = lineAt(text, at);
  let range: TextRange;
  if (motion === "w" && operator === "c" && charClass(text[at]) !== 0) {
    let end = at;
    while (end + 1 < line.to && charClass(text[end + 1]) === charClass(text[at])) end += 1;
    range = { from: at, to: end + 1 };
  } else if (motion === "w") {
    const target = nextWordStart(text, at);
    range = { from: at, to: target !== null && target < line.to ? target : line.to };
  } else if (motion === "e") {
    const end = wordEnd(text, at);
    range = { from: at, to: end !== null && end < line.to ? end + 1 : line.to };
  } else if (motion === "l" || motion === "$") {
    range = { from: at, to: motion === "l" ? Math.min(at + 1, line.to) : line.to };
  } else {
    const target = motionTarget(text, at, motion) ?? line.from;
    const from = Math.max(target, line.from);
    range = from <= at ? { from, to: at } : { from: at, to: from };
  }
  return range.from < range.to ? range : null;
}

/** The line `dd` removes with one newline, or null when it is the block's only line. */
export function lineDeletionRange(text: string, at: number): TextRange | null {
  const line = lineAt(text, at);
  if (line.from === 0 && line.to === text.length) return null;
  return line.to < text.length
    ? { from: line.from, to: line.to + 1 }
    : { from: line.from - 1, to: line.to };
}
