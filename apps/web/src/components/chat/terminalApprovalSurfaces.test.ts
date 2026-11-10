// @effect-diagnostics nodeBuiltinImport:off - reads the web app's source on disk.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";

const webSource = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../..",
);

// Terminal mode answers every approval in its own prompt (useTerminalApprovalPrompt).
// Each place that answers approvals says how Terminal mode takes it over.
const TAKEN_OVER = {
  "components/chat/usePendingThreadRequests.ts":
    "The thread's own approvals; ChatComposer hands them to the prompt.",
  "components/chat/ChatComposer.tsx": "Hosts the prompt and answers subagent approvals from it.",
  "components/chat/TimelinePendingApprovalRow.tsx":
    "Its buttons sit under data-approval-actions, which Terminal mode hides.",
  "components/chat/ChildThreadApprovals.tsx":
    "Renders nothing in Terminal mode; ChatComposer hands subagent approvals to the prompt.",
};

const answersApprovals = (source: string) =>
  /<ComposerPendingApprovalActions\b|\.respondToApproval\b/.test(source);

it("knows every place the web app answers an approval", () => {
  const files = NodeFS.readdirSync(webSource, { recursive: true })
    .map(String)
    .filter((file) => /\.tsx?$/.test(file) && !/\.(test|browser)\.tsx?$/.test(file))
    .filter((file) =>
      answersApprovals(NodeFS.readFileSync(NodePath.join(webSource, file), "utf8")),
    );
  expect(
    files.toSorted(),
    "Approvals are answered somewhere Terminal mode does not know. Route them into " +
      "useTerminalApprovalPrompt, hide the original in Terminal mode, then list the file here.",
  ).toEqual(Object.keys(TAKEN_OVER).toSorted());
});
