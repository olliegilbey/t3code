import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import { HistorySwipeNavigation, registerSwipeTarget } from "./HistorySwipeNavigation";

const navigateHistory = vi.hoisted(() => vi.fn());
vi.mock("../navigationHistory", () => ({ canNavigateHistory: () => true, navigateHistory }));

// Chromium's wheelDeltaX for a trackpad is -3 × deltaX; for a mouse wheel it counts notches.
function trackpadWheel(deltaX: number, deltaY = 0) {
  const init = {
    deltaX,
    deltaY,
    wheelDeltaX: Math.trunc(-3 * deltaX),
    wheelDeltaY: Math.trunc(-3 * deltaY),
  };
  return new WheelEvent("wheel", { ...init, bubbles: true, composed: true });
}

function mouseTilt(direction: "left" | "right") {
  const deltaX = direction === "left" ? -4 : 4;
  const init = { deltaX, wheelDeltaX: direction === "left" ? 120 : -120 };
  return new WheelEvent("wheel", { ...init, bubbles: true, composed: true });
}

function swipe(target: Element, deltaX: number) {
  for (const delta of [deltaX, 0]) target.dispatchEvent(trackpadWheel(delta));
}

describe("HistorySwipeNavigation", () => {
  it.each([
    ["scrolling left inside a shadow-root scroller keeps the thread", "shadow", 100, -130, false],
    ["scrolling right inside a shadow-root scroller keeps the thread", "shadow", 100, 130, false],
    [
      "scrolling after a shadow scroller remount keeps the thread",
      "shadow-remount",
      100,
      130,
      false,
    ],
    ["scrolling left inside a scroller keeps the thread", "light", 100, -130, false],
    ["scrolling at a shadow-root scroller's left edge keeps the thread", "shadow", 0, -130, false],
    [
      "scrolling at a shadow-root scroller's right edge keeps the thread",
      "shadow",
      800,
      130,
      false,
    ],
    ["scrolling at a scroller's left edge keeps the thread", "light", 0, -130, false],
    ["scrolling at a scroller's right edge keeps the thread", "light", 800, 130, false],
    ["scrolling over a preview panel keeps the thread", "preview-panel", 0, -130, false],
    ["scrolling over a desktop preview keeps the thread", "preview-viewport", 0, 130, false],
    ["scrolling over a streamed preview keeps the thread", "server-browser", 0, -130, false],
    ["swiping back over a panel without overflow navigates", "none", 0, -130, true],
    ["a swipe that started in a closed dialog keeps the thread", "closed-dialog", 0, -130, false],
    ["swiping back over an open alert dialog keeps the thread", "alertdialog", 0, -130, false],
  ] as const)("%s", async (_name, scroller, scrollLeft, deltaX, navigates) => {
    navigateHistory.mockReset();
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await using screen = await render(<HistorySwipeNavigation />);
    const panel = screen.container.appendChild(document.createElement("div"));
    const root = scroller.startsWith("shadow") ? panel.attachShadow({ mode: "open" }) : panel;
    const viewport = root.appendChild(document.createElement("div"));
    const noOverflow = !scroller.startsWith("shadow") && scroller !== "light";
    if (scroller === "preview-panel") panel.setAttribute("data-preview-panel-mode", "inline");
    if (scroller === "preview-viewport") panel.setAttribute("data-preview-viewport", "tab");
    if (scroller === "server-browser") panel.setAttribute("data-server-browser-surface", "tab");
    if (scroller === "alertdialog") panel.setAttribute("role", "alertdialog");
    viewport.style.cssText = `width: 200px; overflow-x: ${noOverflow ? "visible" : "auto"}`;
    const content = viewport.appendChild(document.createElement("div"));
    content.style.cssText = `height: 20px; width: ${noOverflow ? 100 : 1000}px`;
    viewport.scrollLeft = scrollLeft;

    if (scroller === "closed-dialog") {
      panel.setAttribute("role", "dialog");
      content.dispatchEvent(trackpadWheel(-1));
      panel.remove();
      screen.container.appendChild(viewport);
    }

    if (scroller === "shadow-remount") {
      content.dispatchEvent(trackpadWheel(1));
      const replacement = viewport.cloneNode(true) as HTMLDivElement;
      viewport.replaceWith(replacement);
      replacement.scrollLeft = scrollLeft;
      swipe(replacement, deltaX);
    } else {
      swipe(content, deltaX);
    }

    expect(navigateHistory).toHaveBeenCalledTimes(navigates ? 1 : 0);
  });

  it("a horizontal mouse wheel tick off macOS keeps the thread", async () => {
    navigateHistory.mockReset();
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    await using screen = await render(<HistorySwipeNavigation />);
    const content = screen.container.appendChild(document.createElement("div"));
    content.style.cssText = "height: 20px; width: 100px";

    swipe(content, -120);

    expect(navigateHistory).not.toHaveBeenCalled();
  });

  it.each([
    ["Shift-scroll keeps the thread", [[-130, true]]],
    [
      "pressing Shift during a swipe cancels navigation",
      [
        [-130, false],
        [-1, true],
      ],
    ],
    [
      "releasing Shift during a scroll keeps the thread",
      [
        [-1, true],
        [-130, false],
      ],
    ],
  ] as const)("%s", async (_name, events) => {
    navigateHistory.mockReset();
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await using screen = await render(<HistorySwipeNavigation />);
    for (const [deltaX, shiftKey] of [...events, [0, false] as const]) {
      screen.container.dispatchEvent(new WheelEvent("wheel", { deltaX, shiftKey, bubbles: true }));
    }
    expect(navigateHistory).not.toHaveBeenCalled();
  });

  // A vertical scroll 15° off vertical.
  const drift = Array.from({ length: 30 }, () => [-4, 15] as const);
  it.each([
    [
      "a vertical scroll that starts slightly diagonally keeps the thread",
      [[-5, 3], ...drift],
      false,
    ],
    [
      "a swipe that leans diagonally for two events navigates",
      [
        [-5, 3],
        [-2, 2],
        [-150, 0],
      ],
      true,
    ],
    ["a single diagonal event past the trigger keeps the thread", [[-130, 100]], false],
  ] as const)("%s", async (_name, events, navigates) => {
    navigateHistory.mockReset();
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await using screen = await render(<HistorySwipeNavigation />);
    const panel = screen.container.appendChild(document.createElement("div"));
    for (const [deltaX, deltaY] of [...events, [0, 0] as const]) {
      panel.dispatchEvent(trackpadWheel(deltaX, deltaY));
    }

    expect(navigateHistory).toHaveBeenCalledTimes(navigates ? 1 : 0);
  });

  it.each([
    ["a swipe over a swipe target goes to the target, not history", true],
    ["a swipe the target cannot take keeps the thread", false],
  ])("%s", async (_name, canSwipe) => {
    navigateHistory.mockReset();
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await using screen = await render(<HistorySwipeNavigation />);
    const panel = screen.container.appendChild(document.createElement("div"));
    const row = panel.appendChild(document.createElement("div"));
    const swipeTo = vi.fn();
    using _target = {
      [Symbol.dispose]: registerSwipeTarget(panel, { canSwipe: () => canSwipe, swipe: swipeTo }),
    };

    swipe(row, -130);

    expect(swipeTo.mock.calls).toEqual(canSwipe ? [["back"]] : []);
    expect(navigateHistory).not.toHaveBeenCalled();
  });

  it("a long swipe over a swipe target steps as it travels, and steps back when it reverses", async () => {
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await using screen = await render(<HistorySwipeNavigation />);
    const panel = screen.container.appendChild(document.createElement("div"));
    const swipeTo = vi.fn();
    using _target = {
      [Symbol.dispose]: registerSwipeTarget(panel, { canSwipe: () => true, swipe: swipeTo }),
    };

    for (const deltaX of [
      ...Array.from({ length: 12 }, () => 40),
      ...Array.from({ length: 6 }, () => -40),
    ]) {
      panel.dispatchEvent(trackpadWheel(deltaX));
    }

    expect(swipeTo.mock.calls).toEqual([["forward"], ["forward"], ["forward"], ["back"]]);
  });

  it("off the macOS desktop app, swipes step a target once each, and never navigate", async () => {
    navigateHistory.mockReset();
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    await using screen = await render(<HistorySwipeNavigation history={false} />);
    const panel = screen.container.appendChild(document.createElement("div"));
    const outside = screen.container.appendChild(document.createElement("div"));
    const swipeTo = vi.fn();
    using _target = {
      [Symbol.dispose]: registerSwipeTarget(panel, { canSwipe: () => true, swipe: swipeTo }),
    };

    // No zero-delta event ends these swipes; only the pause between them does.
    for (const [element, start] of [
      [panel, 0],
      [panel, 1000],
      [outside, 2000],
    ] as const) {
      for (const offset of [0, 16, 32]) {
        const event = trackpadWheel(-40);
        Object.defineProperty(event, "timeStamp", { value: start + offset });
        element.dispatchEvent(event);
      }
    }

    expect(swipeTo.mock.calls).toEqual([["back"], ["back"]]);
    expect(navigateHistory).not.toHaveBeenCalled();
  });

  it("a mouse tilt click over a swipe target steps once, however long it is held", async () => {
    navigateHistory.mockReset();
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await using screen = await render(<HistorySwipeNavigation />);
    const panel = screen.container.appendChild(document.createElement("div"));
    const swipeTo = vi.fn();
    using _target = {
      [Symbol.dispose]: registerSwipeTarget(panel, { canSwipe: () => true, swipe: swipeTo }),
    };

    for (const direction of ["right", "right", "right", "left"] as const) {
      panel.dispatchEvent(mouseTilt(direction));
    }

    expect(swipeTo.mock.calls).toEqual([["forward"], ["back"]]);
    expect(navigateHistory).not.toHaveBeenCalled();
  });
});
