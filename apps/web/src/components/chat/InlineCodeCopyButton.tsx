import { useGT } from "gt-react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { Button } from "../ui/button";
import { reportMarkdownActionFailure } from "./markdownActionFailure";

const INLINE_CODE_SELECTOR = ".chat-markdown code[data-inline-code]";
const BUTTON_ATTRIBUTE = "data-inline-code-copy";

interface HoveredCode {
  readonly element: Element;
  readonly left: number;
  readonly top: number;
}

/**
 * One copy button for all chat inline code. Chat markdown renders inline code as static HTML,
 * so a per-code React button would undo that; this follows the mouse instead.
 */
export function InlineCodeCopyButton() {
  const gt = useGT();
  const [hovered, setHovered] = useState<HoveredCode | null>(null);
  const [copiedElement, setCopiedElement] = useState<Element | null>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard<Element>({
    timeout: 1200,
    onCopy: setCopiedElement,
    onError: (cause) => reportMarkdownActionFailure({ operation: "copy-inline-code" }, cause),
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks the mouse over static chat HTML that React does not render
  useEffect(() => {
    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !(event.target instanceof Element)) return;
      if (event.target.closest(`[${BUTTON_ATTRIBUTE}]`)) return;
      const element = event.target.closest(INLINE_CODE_SELECTOR);
      // A wrapped span ends on its last line box.
      const rect = element ? [...element.getClientRects()].at(-1) : undefined;
      setHovered((current) =>
        current?.element === element
          ? current
          : element && rect
            ? { element, left: rect.right, top: rect.top + rect.height / 2 }
            : null,
      );
    };
    const hide = () => setHovered(null);
    document.addEventListener("pointerover", onPointerOver);
    document.documentElement.addEventListener("pointerleave", hide);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("pointerover", onPointerOver);
      document.documentElement.removeEventListener("pointerleave", hide);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  if (!hovered?.element.isConnected) return null;
  const copied = isCopied && copiedElement === hovered.element;
  return createPortal(
    <span
      {...{ [BUTTON_ATTRIBUTE]: "" }}
      className="fixed z-50 flex -translate-y-1/2 rounded-sm bg-popover shadow-xs"
      style={{ left: hovered.left, top: hovered.top }}
    >
      <Button
        type="button"
        variant="ghost-muted"
        size="icon-micro"
        aria-label={copied ? gt("Copied") : gt("Copy code")}
        // Keeps focus where it was, such as the composer.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => copyToClipboard(hovered.element.textContent ?? "", hovered.element)}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </span>,
    document.body,
  );
}
