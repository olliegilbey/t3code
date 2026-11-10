import { Check, Copy } from "lucide";
import { useRef, type ComponentProps } from "react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { cn } from "../../lib/utils";
import { renderedMarkdownClipboardPayload } from "../../markdown-clipboard";
import { MorphIcon } from "../MorphIcon";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { reportMarkdownActionFailure } from "./markdownActionFailure";

/** Agents often quote a message for the user to send on, so a quote copies like a code block. */
export function CopyableBlockquote({
  children,
  className,
  ...props
}: ComponentProps<"blockquote">) {
  const quoteRef = useRef<HTMLQuoteElement | null>(null);
  const { copyToClipboard, isCopied: copied } = useCopyToClipboard({
    timeout: 1200,
    onError: (cause) => reportMarkdownActionFailure({ operation: "copy-quote" }, cause),
  });
  const copyLabel = copied ? "Copied" : "Copy quote";

  const handleCopy = () => {
    if (!quoteRef.current) return;
    const payload = renderedMarkdownClipboardPayload(quoteRef.current);
    // The HTML keeps bold, links and lists when pasted into rich editors such as Slack.
    copyToClipboard(payload.text, undefined, { "text/html": payload.html });
  };

  return (
    <blockquote ref={quoteRef} {...props} className={cn(className, "relative pe-7")}>
      {/* select-none keeps the button out of both selection copies and this one. */}
      <span data-thread-find-ignore="" className="absolute end-0 top-0 select-none">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost-muted"
                size="icon-xs"
                onClick={handleCopy}
                aria-label={copyLabel}
              />
            }
          >
            <MorphIcon className="size-3" icon={copied ? Check : Copy} />
          </TooltipTrigger>
          <TooltipPopup side="top">{copyLabel}</TooltipPopup>
        </Tooltip>
      </span>
      {children}
    </blockquote>
  );
}
