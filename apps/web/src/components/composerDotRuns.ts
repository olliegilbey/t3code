import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const DOT_RUN = /\.{2,}/g;
const dotRunsKey = new PluginKey<DecorationSet>("composer-dot-runs");

function dotRunDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || node.text === undefined) return;
    for (const match of node.text.matchAll(DOT_RUN)) {
      const from = pos + match.index;
      decorations.push(
        Decoration.inline(from, from + match[0].length, { class: "composer-dot-run" }),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

/** Marks runs of dots, so terminal mode can draw them without the code font's ligatures. */
export const ComposerDotRunsExtension = Extension.create({
  name: "composer-dot-runs",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: dotRunsKey,
        state: {
          init: (_, state) => dotRunDecorations(state.doc),
          apply: (tr, decorations) => (tr.docChanged ? dotRunDecorations(tr.doc) : decorations),
        },
        props: {
          decorations: (state) => dotRunsKey.getState(state),
        },
      }),
    ];
  },
});
