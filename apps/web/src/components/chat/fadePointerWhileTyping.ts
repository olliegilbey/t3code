const POINTER_FADED_ATTRIBUTE = "data-pointer-faded";

const EDITING_KEYS = new Set(["Backspace", "Delete", "Enter", "Tab"]);

export function isTypingKeyDown(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "isComposing">,
): boolean {
  if (event.metaKey || event.ctrlKey) return false;
  return event.isComposing || event.key.length === 1 || EDITING_KEYS.has(event.key);
}

/** Fades the pointer over `surface` until the mouse really moves, like macOS text views. */
export function fadePointerWhileTyping(surface: HTMLElement, event: KeyboardEvent): void {
  if (surface.hasAttribute(POINTER_FADED_ATTRIBUTE) || !isTypingKeyDown(event)) return;
  surface.setAttribute(POINTER_FADED_ATTRIBUTE, "");
  const view = surface.ownerDocument.defaultView;
  if (!view) return;
  const reveal = (move: PointerEvent) => {
    // Layout shifts under a still mouse can dispatch zero-movement moves.
    if (move.movementX === 0 && move.movementY === 0) return;
    view.removeEventListener("pointermove", reveal);
    surface.removeAttribute(POINTER_FADED_ATTRIBUTE);
  };
  view.addEventListener("pointermove", reveal, { passive: true });
}
