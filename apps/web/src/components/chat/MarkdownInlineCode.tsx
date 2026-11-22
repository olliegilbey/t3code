import { useGT } from "gt-react";
import { CheckIcon, CopyIcon } from "lucide-react";
import type React from "react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { Button } from "../ui/button";
import { reportMarkdownActionFailure } from "./markdownActionFailure";

export function MarkdownInlineCode({
  code,
  children,
  ...props
}: React.ComponentProps<"code"> & { code: string }) {
  const gt = useGT();
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    timeout: 1200,
    onError: (cause) => reportMarkdownActionFailure({ operation: "copy-inline-code" }, cause),
  });
  return (
    <span className="group/inline-code relative">
      <code {...props}>{children}</code>
      {/* `invisible`, not `opacity-0`: a hidden button must not catch clicks on the text it covers. */}
      <span className="invisible absolute start-full top-1/2 z-10 -translate-y-1/2 rounded-sm bg-popover shadow-xs select-none pointer-fine:group-hover/inline-code:visible">
        <Button
          type="button"
          variant="ghost-muted"
          size="icon-micro"
          aria-label={isCopied ? gt("Copied") : gt("Copy code")}
          onClick={() => copyToClipboard(code)}
        >
          {isCopied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </span>
    </span>
  );
}
