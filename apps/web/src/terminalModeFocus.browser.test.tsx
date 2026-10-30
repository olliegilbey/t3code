import "./index.css";
import "./terminal-mode.css";

import { userEvent } from "vite-plus/test/browser";
import { describe, expect, it } from "vite-plus/test";

import { workspaceAreaProps } from "./lib/workspaceFocus";
import { setTerminalModeEnabled } from "./terminalMode";

function terminalMode(enabled: boolean): Disposable {
  setTerminalModeEnabled(enabled);
  return { [Symbol.dispose]: () => setTerminalModeEnabled(false) };
}

function mountComposerArea() {
  const area = document.createElement("div");
  for (const [name, value] of Object.entries(workspaceAreaProps("composer", 2, "Message input"))) {
    area.setAttribute(name === "tabIndex" ? "tabindex" : name, String(value));
  }
  area.style.height = "40px";
  document.body.append(area);
  return Object.assign(area, { [Symbol.dispose]: () => area.remove() });
}

async function focusAfterKeyboard(area: HTMLElement) {
  // Script focus after a key press matches :focus-visible, as a click can on macOS.
  await userEvent.keyboard("{Shift}");
  area.focus();
  expect(area.matches(":focus-visible")).toBe(true);
}

describe("the composer area's focus ring", () => {
  it("does not frame the bottom of the chat in Terminal mode", async () => {
    using _mode = terminalMode(true);
    using area = mountComposerArea();
    await focusAfterKeyboard(area);
    expect(getComputedStyle(area).outlineStyle).toBe("none");
  });

  it("stays as it was outside Terminal mode", async () => {
    using _mode = terminalMode(false);
    using area = mountComposerArea();
    await focusAfterKeyboard(area);
    expect(getComputedStyle(area).outlineStyle).toBe("solid");
  });
});
