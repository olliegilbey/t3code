import type { Editor } from "@tiptap/core";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, fakeTimers, render } from "../../test/render";

import { serializeEditorDoc } from "~/composer-rich-text-doc";
import { setTerminalModeEnabled, setVimKeysEnabled } from "../terminalMode";
import {
  ComposerPromptEditorTiptap,
  type ComposerPromptEditorHandle,
} from "./ComposerPromptEditorTiptap";
import { setComposerVimMode, setVimNormalKeyInterceptor } from "./composerVimKeys";

function Composer({ value }: { value: string }) {
  const [prompt, setPrompt] = useState({ value, cursor: value.length });
  return (
    <ComposerPromptEditorTiptap
      editorRef={createRef<ComposerPromptEditorHandle>()}
      value={prompt.value}
      cursor={prompt.cursor}
      richTextEnabled
      contextRecords={new Map()}
      skills={[]}
      disabled={false}
      placeholder=""
      onChange={(next, cursor) => setPrompt({ value: next, cursor })}
      onPaste={() => {}}
    />
  );
}

function vimKeys(enabled: boolean): Disposable {
  setTerminalModeEnabled(enabled);
  setVimKeysEnabled(enabled);
  return {
    [Symbol.dispose]: () => {
      setTerminalModeEnabled(false);
      setVimKeysEnabled(false);
    },
  };
}

async function mountComposer(value: string) {
  await using stack = new AsyncDisposableStack();
  const screen = stack.use(await render(<Composer value={value} />));
  const element = screen.container.querySelector<HTMLElement & { editor: Editor }>(".tiptap");
  if (!element) throw new Error("Composer did not mount");
  const { editor } = element;
  // ProseMirror rewrites the DOM caret 20ms after focus; run that before typing.
  using _timers = fakeTimers();
  await act(async () => {
    editor.commands.focus("end");
  });
  await vi.waitFor(() => expect(document.activeElement).toBe(editor.view.dom));
  vi.runOnlyPendingTimers();
  const environment = stack.move();
  return Object.assign(screen, {
    [Symbol.asyncDispose]: () => environment.disposeAsync(),
    value: () => serializeEditorDoc(editor.state.doc).value,
    mode: () => editor.view.dom.dataset.vimMode,
    editor,
  });
}

describe("vim keys", () => {
  it("leaves insert mode on Esc, then edits by word", async () => {
    using _vim = vimKeys(true);
    await using composer = await mountComposer("git push origin main");
    await userEvent.keyboard("{Escape}");
    expect(composer.mode()).toBe("normal");
    await userEvent.keyboard("bbdw");
    expect(composer.value()).toBe("git push main");
    await userEvent.keyboard("x");
    expect(composer.value()).toBe("git push ain");
    await userEvent.keyboard("u");
    expect(composer.value()).toBe("git push main");
  });

  it("swallows other keys in normal mode, and A and o go back to typing", async () => {
    using _vim = vimKeys(true);
    await using composer = await mountComposer("one");
    await userEvent.keyboard("{Escape}zq");
    expect(composer.value()).toBe("one");
    await userEvent.keyboard("A two{Escape}othree");
    expect(composer.value()).toBe("one two\nthree");
    expect(composer.mode()).toBe("insert");
  });

  it("removes a list item with dd", async () => {
    using _vim = vimKeys(true);
    await using composer = await mountComposer("- first\n- second");
    await userEvent.keyboard("{Escape}ggdd");
    expect(composer.value()).toBe("- second");
  });

  it("starts the next message in insert mode once the composer clears", async () => {
    using _vim = vimKeys(true);
    await using composer = await mountComposer("sent");
    await userEvent.keyboard("{Escape}");
    await act(async () => {
      composer.editor.commands.clearContent(true);
    });
    expect(composer.mode()).toBe("insert");
  });

  it("leaves every key alone while the setting is off", async () => {
    using _vim = vimKeys(false);
    await using composer = await mountComposer("one");
    await userEvent.keyboard("{Escape}dd");
    expect(composer.value()).toBe("onedd");
  });

  it("offers normal mode keys to an interceptor while the composer is empty", async () => {
    using _vim = vimKeys(true);
    await using composer = await mountComposer("");
    const keys: string[] = [];
    setVimNormalKeyInterceptor(composer.editor.view, (key) => {
      keys.push(key);
      return true;
    });
    await userEvent.keyboard("{Escape}j");
    expect(keys).toEqual(["j"]);
  });

  it("keeps j and k as motions once the composer has text", async () => {
    using _vim = vimKeys(true);
    await using composer = await mountComposer("a\nb");
    const keys: string[] = [];
    setVimNormalKeyInterceptor(composer.editor.view, (key) => {
      keys.push(key);
      return true;
    });
    await userEvent.keyboard("{Escape}kx");
    expect(keys).toEqual([]);
    expect(composer.value()).toBe("\nb");
  });

  it("switches mode on request", async () => {
    using _vim = vimKeys(true);
    await using composer = await mountComposer("one");
    await userEvent.keyboard("{Escape}");
    await act(async () => {
      setComposerVimMode(composer.editor.view, "insert");
    });
    expect(composer.mode()).toBe("insert");
  });
});
