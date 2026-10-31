import type { ApprovalResponder } from "@t3tools/client-runtime/state/thread-requests";
import {
  EnvironmentId,
  RuntimeRequestId,
  ThreadId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useImperativeHandle, type RefObject } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render } from "../../../test/render";
import { useComposerDraftStore } from "../../composerDraftStore";
import type { PendingApproval } from "../../session-logic";
import { setTerminalModeEnabled } from "../../terminalMode";
import { BackgroundThreadContext } from "./backgroundThread";
import { useTerminalApprovalPrompt } from "./useTerminalApprovalPrompt";

type Hook = ReturnType<typeof useTerminalApprovalPrompt>;

const TARGET: ScopedThreadRef = {
  environmentId: EnvironmentId.make("env-terminal-approval"),
  threadId: ThreadId.make("thread-terminal-approval"),
};

function approval(id: string, live = true): PendingApproval {
  return {
    requestId: RuntimeRequestId.make(id),
    requestKind: "command",
    createdAt: "2026-10-30T00:00:00.000Z",
    detail: `run ${id}`,
    responseCapability: live ? "live" : "not_resumable",
  };
}

function Harness(props: {
  readonly approvals: ReadonlyArray<PendingApproval>;
  readonly hookRef: RefObject<Hook | null>;
  readonly promptRef: { current: string };
  readonly respond: ApprovalResponder;
  readonly sendNote: () => void;
  readonly focusEditor: () => void;
}) {
  const prompt = useComposerDraftStore((store) => store.getComposerDraft(TARGET)?.prompt ?? "");
  const result = useTerminalApprovalPrompt({
    approval: props.approvals[0] ?? null,
    pendingApprovals: props.approvals,
    respondingRequestIds: [],
    canOperate: true,
    prompt,
    promptRef: props.promptRef,
    composerDraftTarget: TARGET,
    editorRef: {
      current: {
        focus: props.focusEditor,
        setVimMode: () => {},
        setVimNormalKeyInterceptor: () => {},
      },
    },
    onRespondToApproval: props.respond,
    sendNote: props.sendNote,
  });
  useImperativeHandle(props.hookRef, () => result);
  return null;
}

function setup() {
  setTerminalModeEnabled(true);
  useComposerDraftStore.getState().setPrompt(TARGET, "");
  const promptRef = { current: "" };
  const hookRef: RefObject<Hook | null> = { current: null };
  const respond = vi.fn<ApprovalResponder>(
    async () => ({ _tag: "Success" }) as Awaited<ReturnType<ApprovalResponder>>,
  );
  const sentDrafts: string[] = [];
  const sendNote = vi.fn(() => {
    sentDrafts.push(useComposerDraftStore.getState().getComposerDraft(TARGET)?.prompt ?? "");
  });
  const focusEditor = vi.fn();
  const harness = (approvals: ReadonlyArray<PendingApproval>) => (
    <Harness
      approvals={approvals}
      hookRef={hookRef}
      promptRef={promptRef}
      respond={respond}
      sendNote={sendNote}
      focusEditor={focusEditor}
    />
  );
  const type = async (text: string) => {
    await act(() => {
      promptRef.current = text;
      useComposerDraftStore.getState().setPrompt(TARGET, text);
    });
  };
  const hook = () => {
    if (!hookRef.current) throw new Error("hook did not mount");
    return hookRef.current;
  };
  const enter = () => hook().onKey("Enter", new KeyboardEvent("keydown", { key: "Enter" }));
  // Past the arming beat, the flash and the result line.
  const settle = () => act(() => vi.advanceTimersByTimeAsync(2000));
  return {
    respond,
    sendNote,
    focusEditor,
    sentDrafts,
    harness,
    type,
    hook,
    enter,
    settle,
    [Symbol.dispose]: () => setTerminalModeEnabled(false),
  };
}

describe("useTerminalApprovalPrompt", () => {
  it("ignores Enter for a moment after a request shows", async () => {
    using t = setup();
    using _timers = fakeTimers();
    await using _screen = await render(t.harness([approval("a")]), { router: false });
    expect(t.enter()).toBe(false);
    expect(t.respond).not.toHaveBeenCalled();
    await t.settle();
    await act(() => t.enter());
    expect(t.respond).toHaveBeenCalledWith(RuntimeRequestId.make("a"), "accept", undefined);
  });

  it("takes the keyboard when an answerable request shows, so Enter answers it", async () => {
    using t = setup();
    await using screen = await render(
      <>
        <button type="button">Expand tool output</button>
        {t.harness([])}
      </>,
      { router: false },
    );
    screen.getByRole("button").element().focus();
    await screen.rerender(
      <>
        <button type="button">Expand tool output</button>
        {t.harness([approval("stale", false)])}
      </>,
    );
    expect(t.focusEditor).not.toHaveBeenCalled();
    await screen.rerender(
      <>
        <button type="button">Expand tool output</button>
        {t.harness([approval("a")])}
      </>,
    );
    expect(t.focusEditor).toHaveBeenCalledTimes(1);
  });

  it("leaves focus in another field, and in a thread kept behind Settings", async () => {
    using t = setup();
    const page = (approvals: ReadonlyArray<PendingApproval>, background = false) => (
      <>
        <input aria-label="Find in thread" />
        <button type="button">Settings row</button>
        <BackgroundThreadContext value={background}>{t.harness(approvals)}</BackgroundThreadContext>
      </>
    );
    await using screen = await render(page([]), { router: false });
    screen.getByRole("textbox").element().focus();
    await screen.rerender(page([approval("a")]));
    screen.getByRole("button").element().focus();
    await screen.rerender(page([approval("b")], true));
    expect(t.focusEditor).not.toHaveBeenCalled();
  });

  it("keeps a message you were typing as a message, not a reason to decline", async () => {
    using t = setup();
    using _timers = fakeTimers();
    await using screen = await render(t.harness([]), { router: false });
    await t.type("unrelated message");
    await screen.rerender(t.harness([approval("a")]));
    await t.settle();
    await act(() => t.hook().onRun(0));
    expect(t.respond).toHaveBeenLastCalledWith(RuntimeRequestId.make("a"), "accept", undefined);
    await t.settle();
    expect(useComposerDraftStore.getState().getComposerDraft(TARGET)?.prompt).toBe(
      "unrelated message",
    );
    await screen.rerender(t.harness([approval("b")]));
    await t.settle();
    expect(await act(() => t.hook().onSubmit())).toBe(true);
    expect(t.respond).toHaveBeenCalledTimes(1);
    expect(useComposerDraftStore.getState().getComposerDraft(TARGET)?.prompt ?? "").toBe("");
    // A second Enter straight after holding the message does not answer.
    expect(t.enter()).toBe(false);
    await screen.rerender(t.harness([]));
    await t.settle();
    expect(t.sentDrafts).toEqual(["unrelated message"]);
  });

  it("holds a send while the answer is in flight, after the request has gone", async () => {
    using t = setup();
    using _timers = fakeTimers();
    await using screen = await render(t.harness([approval("a")]), { router: false });
    await t.settle();
    t.respond.mockReturnValueOnce(new Promise(() => {}));
    await t.type("use bun");
    await act(() => t.hook().onSubmit());
    await screen.rerender(t.harness([]));
    expect(t.hook().onSubmit()).toBe(true);
  });

  it("keeps every reason given while other requests wait, and sends them together", async () => {
    using t = setup();
    using _timers = fakeTimers();
    const [a, b] = [approval("a"), approval("b")];
    await using screen = await render(t.harness([a, b]), { router: false });
    await t.settle();
    await t.type("first reason");
    await act(() => t.hook().onRun(0));
    await t.settle();
    await screen.rerender(t.harness([b]));
    await t.settle();
    await t.type("second reason");
    await act(() => t.hook().onRun(0));
    await t.settle();
    await screen.rerender(t.harness([]));
    await t.settle();
    expect(t.sendNote).toHaveBeenCalledTimes(1);
    expect(t.sentDrafts[0]).toContain("first reason");
    expect(t.sentDrafts[0]).toContain("second reason");
  });

  it("puts a waiting reason back in its draft when the composer goes away", async () => {
    using t = setup();
    using _timers = fakeTimers();
    const screen = await render(t.harness([approval("a"), approval("b")]), { router: false });
    await t.settle();
    await t.type("keep me");
    await act(() => t.hook().onRun(0));
    await t.settle();
    await screen[Symbol.asyncDispose]();
    expect(useComposerDraftStore.getState().getComposerDraft(TARGET)?.prompt).toBe("keep me");
  });

  it("sends a waiting reason once only unanswerable requests remain", async () => {
    using t = setup();
    using _timers = fakeTimers();
    const stale = approval("b", false);
    await using screen = await render(t.harness([approval("a"), stale]), { router: false });
    await t.settle();
    await t.type("go on");
    await act(() => t.hook().onRun(0));
    await t.settle();
    await screen.rerender(t.harness([stale]));
    await t.settle();
    expect(t.sendNote).toHaveBeenCalledTimes(1);
  });
});
