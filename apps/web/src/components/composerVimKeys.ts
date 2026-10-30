import { Extension } from "@tiptap/core";
import { closeHistory, isHistoryTransaction, redo, undo } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { canSplit } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";

import { vimKeysActive } from "../terminalMode";
import {
  clampToLine,
  firstNonBlank,
  isVimMotion,
  lineAt,
  lineDeletionRange,
  motionTarget,
  operatorRange,
} from "./composerVim.logic";

interface VimState {
  readonly mode: "insert" | "normal";
  readonly pending: "" | "c" | "d" | "g";
  /** Where j and k aim across short lines, in screen pixels, as vim's curswant does. */
  readonly goalX?: number;
}

const INSERT: VimState = { mode: "insert", pending: "" };
const NORMAL: VimState = { mode: "normal", pending: "" };
const vimKey = new PluginKey<VimState>("composer-vim");

function blockText(block: ProseMirrorNode): string {
  return block.textBetween(0, block.content.size, undefined, (leaf) =>
    leaf.type.name === "hardBreak" ? "\n" : "\uFFFC",
  );
}

interface Caret {
  readonly $head: ResolvedPos;
  readonly text: string;
  readonly start: number;
  readonly at: number;
}

function caretIn($head: ResolvedPos): Caret | null {
  if (!$head.parent.isTextblock) return null;
  return { $head, text: blockText($head.parent), start: $head.start(), at: $head.parentOffset };
}

function tagged(view: EditorView, next: VimState) {
  return (tr: Transaction) => {
    // Each normal mode change undoes on its own; typing after c or o joins it, as in vim.
    if (tr.docChanged && !isHistoryTransaction(tr)) closeHistory(tr);
    view.dispatch(tr.setMeta(vimKey, next).scrollIntoView());
  };
}

function setVim(view: EditorView, next: VimState): void {
  view.dispatch(view.state.tr.setMeta(vimKey, next));
}

export function setComposerVimMode(view: EditorView, mode: VimState["mode"]): void {
  setVim(view, mode === "insert" ? INSERT : NORMAL);
}

const normalKeyInterceptors = new WeakMap<EditorView, (key: string) => boolean>();

/** Offers normal mode keys to `fn` while the composer is empty, ahead of the vim commands. */
export function setVimNormalKeyInterceptor(
  view: EditorView,
  fn: ((key: string) => boolean) | null,
): void {
  if (fn) normalKeyInterceptors.set(view, fn);
  else normalKeyInterceptors.delete(view);
}

function moveTo(view: EditorView, pos: number, next: VimState = NORMAL): void {
  const { state } = view;
  tagged(view, next)(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

/** Where normal mode rests near `pos`: on a character, or on a line's first non-blank. */
function restingPos(doc: ProseMirrorNode, pos: number, lineStart = false): number {
  const caret = caretIn(doc.resolve(pos));
  if (!caret) return pos;
  const at = lineStart ? firstNonBlank(caret.text, lineAt(caret.text, caret.at)) : caret.at;
  return caret.start + clampToLine(caret.text, at);
}

function deleteAndRest(
  view: EditorView,
  from: number,
  to: number,
  next: VimState,
  lineStart = false,
): void {
  const tr = view.state.tr.delete(from, to);
  const pos = next.mode === "normal" ? restingPos(tr.doc, from, lineStart) : from;
  tagged(view, next)(tr.setSelection(TextSelection.create(tr.doc, pos)));
}

function moveByWord(view: EditorView, caret: Caret, motion: "w" | "b" | "e"): void {
  const target = motionTarget(caret.text, caret.at, motion);
  if (target !== null) return moveTo(view, caret.start + target);
  // Word motions run on into the next or previous block.
  const { doc } = view.state;
  const forward = motion !== "b";
  const edge = forward ? caret.$head.after() : caret.$head.before();
  const neighbor = Selection.findFrom(doc.resolve(edge), forward ? 1 : -1, true);
  const next = neighbor ? caretIn(neighbor.$head) : null;
  // Past the last word, w rests on the final character.
  if (!next)
    return motion === "w"
      ? moveTo(view, caret.start + clampToLine(caret.text, caret.text.length))
      : undefined;
  const at =
    motion === "w"
      ? firstNonBlank(next.text, lineAt(next.text, 0))
      : (motionTarget(next.text, motion === "e" ? -1 : next.text.length, motion) ?? 0);
  moveTo(view, next.start + clampToLine(next.text, at));
}

// The browser knows where wrapped lines break, so j and k move by what is on screen.
function moveByLine(view: EditorView, vim: VimState, direction: "forward" | "backward"): void {
  const selection = view.dom.ownerDocument.getSelection();
  const { focusNode, focusOffset } = selection ?? {};
  if (!selection || !focusNode || !view.dom.contains(focusNode)) return;
  if (typeof selection.modify !== "function") return;
  const from = view.coordsAtPos(view.state.selection.head);
  const goalX = vim.goalX ?? from.left;
  // Probe the next line, then put the DOM caret back; the transaction below moves it.
  selection.collapse(focusNode, focusOffset);
  selection.modify("move", direction, "line");
  const landedNode = selection.focusNode;
  const landed =
    landedNode && view.dom.contains(landedNode)
      ? view.posAtDOM(landedNode, selection.focusOffset)
      : null;
  selection.collapse(focusNode, focusOffset);
  if (landed === null) return;
  const line = view.coordsAtPos(landed);
  // On the first or last line the browser slides along it instead; vim stays put.
  if (Math.abs(line.top - from.top) < (from.bottom - from.top) / 2) return;
  const aimed = view.posAtCoords({ left: goalX, top: (line.top + line.bottom) / 2 });
  const aimedLine = aimed ? view.coordsAtPos(aimed.pos) : null;
  const pos = aimed && aimedLine && Math.abs(aimedLine.top - line.top) < 1 ? aimed.pos : landed;
  moveTo(view, restingPos(view.state.doc, pos), { ...NORMAL, goalX });
}

function openLine(view: EditorView, caret: Caret, below: boolean): void {
  const { state } = view;
  const { schema } = state;
  const line = lineAt(caret.text, caret.at);
  const edge = caret.start + (below ? line.to : line.from);
  const tr = state.tr;
  const hardBreak = schema.nodes.hardBreak;
  if (caret.$head.parent.type.spec.code) {
    tr.insertText("\n", edge);
  } else if (caret.text.includes("\n") && hardBreak) {
    tr.insert(edge, hardBreak.create());
  } else {
    // A new list item under an item, otherwise a new paragraph.
    const item = caret.$head.depth > 1 ? caret.$head.node(-1) : null;
    const inItem = item !== null && item.type.name.endsWith("Item");
    const paragraph = schema.nodes.paragraph;
    const depth = inItem ? 2 : 1;
    const typesAfter = below
      ? [
          ...(inItem
            ? [
                {
                  type: item.type,
                  attrs: item.type.name === "taskItem" ? { checked: false } : null,
                },
              ]
            : []),
          ...(paragraph ? [{ type: paragraph }] : []),
        ]
      : undefined;
    if (!canSplit(tr.doc, edge, depth, typesAfter)) return;
    tr.split(edge, depth, typesAfter);
    if (below)
      return tagged(view, INSERT)(tr.setSelection(TextSelection.create(tr.doc, edge + depth * 2)));
  }
  const pos = below ? edge + 1 : edge;
  tagged(view, INSERT)(tr.setSelection(TextSelection.create(tr.doc, pos)));
}

function hasOtherTextblock(doc: ProseMirrorNode): boolean {
  let count = 0;
  doc.descendants((node) => {
    if (node.isTextblock) count += 1;
    return count < 2 && !node.isTextblock;
  });
  return count > 1;
}

function runOperator(view: EditorView, caret: Caret, operator: "c" | "d", key: string): void {
  const next = operator === "c" ? INSERT : NORMAL;
  const { text, start, at } = caret;
  if (key === operator) {
    const line = lineAt(text, at);
    const lineRange = operator === "d" ? lineDeletionRange(text, at) : null;
    if (lineRange)
      return deleteAndRest(view, start + lineRange.from, start + lineRange.to, next, true);
    if (operator === "c" || !hasOtherTextblock(view.state.doc)) {
      return deleteAndRest(view, start + line.from, start + line.to, next);
    }
    // The line is its whole block, so the block goes too.
    const tr = view.state.tr.deleteRange(caret.$head.before(), caret.$head.after());
    const pos = Selection.near(tr.doc.resolve(tr.mapping.map(caret.$head.before()))).head;
    return tagged(
      view,
      NORMAL,
    )(tr.setSelection(TextSelection.create(tr.doc, restingPos(tr.doc, pos, true))));
  }
  const range = isVimMotion(key) ? operatorRange(text, at, operator, key) : null;
  if (!range) return setVim(view, NORMAL);
  deleteAndRest(view, start + range.from, start + range.to, next);
}

function runNormalKey(view: EditorView, vim: VimState, key: string): void {
  const { state } = view;
  const caret = caretIn(state.selection.$head);
  if (!caret) return setVim(view, NORMAL);
  const { text, start, at } = caret;
  const line = lineAt(text, at);

  if (vim.pending === "g") {
    if (key !== "g") return setVim(view, NORMAL);
    return moveTo(view, restingPos(state.doc, Selection.atStart(state.doc).head, true));
  }
  if (vim.pending !== "") return runOperator(view, caret, vim.pending, key);

  if (!state.selection.empty && (key === "x" || key === "d" || key === "c")) {
    const { from, to } = state.selection;
    return deleteAndRest(view, from, to, key === "c" ? INSERT : NORMAL);
  }
  switch (key) {
    case "i":
      return setVim(view, INSERT);
    case "a":
      return moveTo(view, start + Math.min(at + 1, line.to), INSERT);
    case "I":
      return moveTo(view, start + firstNonBlank(text, line), INSERT);
    case "A":
      return moveTo(view, start + line.to, INSERT);
    case "o":
    case "O":
      return openLine(view, caret, key === "o");
    case "j":
    case "k":
      return moveByLine(view, vim, key === "j" ? "forward" : "backward");
    case "w":
    case "b":
    case "e":
      return moveByWord(view, caret, key);
    case "G":
      return moveTo(view, restingPos(state.doc, Selection.atEnd(state.doc).head, true));
    case "c":
    case "d":
    case "g":
      return setVim(view, { mode: "normal", pending: key });
    case "x":
    case "s":
      if (at >= line.to) return key === "s" ? setVim(view, INSERT) : undefined;
      return deleteAndRest(view, start + at, start + at + 1, key === "s" ? INSERT : NORMAL);
    case "X":
      if (at <= line.from) return;
      return deleteAndRest(view, start + at - 1, start + at, NORMAL);
    case "D":
    case "C":
      return deleteAndRest(view, start + at, start + line.to, key === "C" ? INSERT : NORMAL);
    case "S":
      return deleteAndRest(view, start + line.from, start + line.to, INSERT);
    case "u":
      undo(state, tagged(view, NORMAL));
      return;
  }
  if (isVimMotion(key)) moveTo(view, start + (motionTarget(text, at, key) ?? at));
}

function handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
  if (!vimKeysActive() || event.isComposing || event.keyCode === 229) return false;
  const vim = vimKey.getState(view.state) ?? INSERT;
  if (vim.mode === "insert") {
    if (event.key !== "Escape" && !(event.ctrlKey && event.key === "[")) return false;
    // Leaving insert mode steps back onto the last character typed, as vim does.
    const caret = caretIn(view.state.selection.$head);
    const back =
      caret && view.state.selection.empty && caret.at > lineAt(caret.text, caret.at).from;
    if (back) moveTo(view, caret.start + caret.at - 1);
    else setVim(view, NORMAL);
    return true;
  }
  if (event.metaKey || event.altKey) return false;
  if (event.ctrlKey) {
    if (event.key !== "r") return false;
    redo(view.state, tagged(view, NORMAL));
    return true;
  }
  if (event.key === "Escape") {
    if (vim.pending === "") return false;
    setVim(view, NORMAL);
    return true;
  }
  const key = event.key === "Backspace" ? "h" : event.key === " " ? "l" : event.key;
  // Enter, Tab and the arrows keep their composer meaning; any other key is a command.
  if (key.length !== 1) return false;
  const intercept = normalKeyInterceptors.get(view);
  if (intercept && vim.pending === "" && isEmptyDoc(view.state.doc) && intercept(key)) return true;
  runNormalKey(view, vim, key);
  return true;
}

function isEmptyDoc(doc: ProseMirrorNode): boolean {
  return doc.childCount === 1 && doc.firstChild?.content.size === 0;
}

/**
 * Insert and normal mode for the composer, active while Terminal mode's vim keys
 * setting is on. The editor carries the mode as `data-vim-mode` for the caret and
 * statusline styles.
 */
export const ComposerVimKeysExtension = Extension.create({
  name: "composer-vim-keys",
  // Ahead of the keymaps, so normal mode's Backspace moves rather than deletes.
  priority: 1000,
  addProseMirrorPlugins() {
    return [
      new Plugin<VimState>({
        key: vimKey,
        state: {
          init: () => INSERT,
          apply: (tr, value) => {
            const next = tr.getMeta(vimKey) as VimState | undefined;
            if (next) return next;
            // Sending clears the composer, and the next message starts in insert mode.
            if (value.mode === "normal" && tr.docChanged && isEmptyDoc(tr.doc)) return INSERT;
            // A click or an edit from elsewhere ends a run of j and k.
            return value.goalX !== undefined && (tr.selectionSet || tr.docChanged)
              ? { mode: value.mode, pending: value.pending }
              : value;
          },
        },
        props: {
          handleKeyDown,
          attributes: (state: EditorState) => ({
            "data-vim-mode": vimKey.getState(state)?.mode ?? "insert",
          }),
        },
      }),
    ];
  },
});
