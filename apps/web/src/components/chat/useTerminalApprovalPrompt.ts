import type { ApprovalResponder } from "@t3tools/client-runtime/state/thread-requests";
import type {
  ProviderApprovalDecision,
  ProviderApprovalOption,
  RuntimeRequestId,
} from "@t3tools/contracts";
import { type RefObject, use, useEffect, useRef, useState } from "react";
import { useStableCallback } from "~/hooks/useStableCallback";
import { composerTargetKey, useComposerDraftStore } from "../../composerDraftStore";
import type { PendingApproval } from "../../session-logic";
import { useTerminalMode } from "../../terminalMode";
import { composerMayTakeFocus } from "../ChatView.logic";
import type { ComposerPromptEditorHandle } from "../ComposerPromptEditorTiptap";
import { BackgroundThreadContext } from "./backgroundThread";
import type { ChatComposerProps } from "./ChatComposer";
import {
  initialTerminalApprovalState,
  orderApprovalOptions,
  planApprovalResponse,
  reduceTerminalApproval,
  resolveTerminalApprovalSubmit,
  type TerminalApprovalEvent,
  type TerminalApprovalState,
} from "./terminalApproval.logic";

const ARM_MS = 400;
const FLASH_MS = 250;
const RESULT_MS = 700;

type DraftTarget = ChatComposerProps["composerDraftTarget"];

interface TerminalApprovalView {
  readonly approval: PendingApproval;
  readonly options: ReadonlyArray<ProviderApprovalOption>;
  readonly state: TerminalApprovalState;
  readonly position: { index: number; total: number };
  readonly flashIndex: number | null;
  readonly result: ProviderApprovalDecision | null;
  readonly hint: string;
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function putNoteInDraft(target: DraftTarget, text: string) {
  const store = useComposerDraftStore.getState();
  const draft = store.getComposerDraft(target)?.prompt ?? "";
  store.setPrompt(target, draft.trim() ? `${text}\n\n${draft}` : text);
}

/**
 * Terminal mode's permission prompt: Enter answers the shown request, arrows and j/k choose,
 * Tab gives the chosen answer a reason. A reason on anything but a decline goes to the agent
 * as a message once no request is left open.
 */
export function useTerminalApprovalPrompt(input: {
  readonly approval: PendingApproval | null;
  readonly pendingApprovals: ReadonlyArray<PendingApproval>;
  readonly respondingRequestIds: ReadonlyArray<RuntimeRequestId>;
  readonly canOperate: boolean;
  readonly prompt: string;
  readonly promptRef: RefObject<string>;
  readonly composerDraftTarget: DraftTarget;
  readonly editorRef: RefObject<Pick<
    ComposerPromptEditorHandle,
    "focus" | "setVimMode" | "setVimNormalKeyInterceptor"
  > | null>;
  readonly onRespondToApproval: ApprovalResponder;
  readonly sendNote: () => void;
}) {
  const { approval, pendingApprovals, promptRef, composerDraftTarget, editorRef, sendNote } = input;
  const terminalMode = useTerminalMode();
  const background = use(BackgroundThreadContext);
  const [stored, setStored] = useState<{
    requestId: RuntimeRequestId;
    state: TerminalApprovalState;
    empty: boolean;
    /** Text there before the prompt armed: a message being written, not a reason. */
    carried: boolean;
  } | null>(null);
  const [feedback, setFeedback] = useState<TerminalApprovalView | null>(null);
  const [notes, setNotes] = useState<ReadonlyArray<{ target: DraftTarget; text: string }>>([]);
  const [armedFor, setArmedFor] = useState<string | null>(null);
  const [holds, setHolds] = useState(0);

  const shown = terminalMode ? approval : null;
  const options = orderApprovalOptions(shown?.options);
  const empty = input.prompt.trim() === "";
  const own = shown && stored?.requestId === shown.requestId ? stored : null;
  // Holding a message restarts the beat, so a second Enter can't answer.
  const armKey = shown ? `${shown.requestId}:${holds}` : null;
  const armed = armKey !== null && armedFor === armKey;
  // Typing binds a reason to Decline, and emptying the composer drops it. Text written before
  // the prompt armed is a message the reader was already sending, so it binds nothing.
  if (shown && own?.empty !== empty) {
    const carried = !empty && (own ? own.carried || !armed : true);
    setStored({
      requestId: shown.requestId,
      state:
        own && !carried
          ? reduceTerminalApproval(own.state, { type: "draft", empty }, options)
          : (own?.state ?? initialTerminalApprovalState(options)),
      empty,
      carried,
    });
  }
  const state = own?.state ?? initialTerminalApprovalState(options);
  const carried = own?.carried ?? !empty;
  const shownId = shown?.requestId ?? null;
  const hereKey = composerTargetKey(composerDraftTarget);
  const messageWaits = notes.some((note) => composerTargetKey(note.target) === hereKey);
  const hint =
    carried && !empty
      ? "Enter sends your message after you answer · Clear it to answer here"
      : `${messageWaits ? "Your message sends after you answer · " : ""}Enter to run · ↑↓ or j/k to choose · Tab to add a reason`;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a request takes answer keys only after a beat, so an Enter meant for a message just sent can't answer it
  useEffect(() => {
    if (armKey === null) return;
    const timer = window.setTimeout(() => setArmedFor(armKey), ARM_MS);
    return () => window.clearTimeout(timer);
  }, [armKey]);
  const answerable = shown?.responseCapability === "live" && input.canOperate;
  const answerableId = answerable && !background ? shownId : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a request takes the keyboard as it shows, so Enter answers it without a click first
  useEffect(() => {
    if (answerableId !== null && composerMayTakeFocus(document.activeElement)) {
      editorRef.current?.focus();
    }
  }, [answerableId, editorRef]);
  const active = armed && answerable && feedback === null;

  const update = (event: TerminalApprovalEvent) => {
    if (!shown) return;
    const next = reduceTerminalApproval(state, event, options);
    if (next !== state) setStored({ requestId: shown.requestId, state: next, empty, carried });
  };

  const run = (index: number | null) => {
    if (!active || !shown) return;
    const text = promptRef.current;
    const picked = index === null ? undefined : options[index];
    const { decision, reason } = picked
      ? { decision: picked.decision, reason: carried ? null : text.trim() || null }
      : resolveTerminalApprovalSubmit(state, options, text);
    const plan = planApprovalResponse(decision, reason, shown.supportsFeedback === true);
    const followUp = plan.followUp;
    const target = composerDraftTarget;
    const view: TerminalApprovalView = {
      approval: shown,
      options,
      state: picked ? { ...state, selected: index ?? state.selected } : state,
      position: { index: 0, total: pendingApprovals.length },
      flashIndex: picked ? index : options.findIndex((option) => option.decision === decision),
      result: null,
      hint,
    };
    setFeedback(view);
    void Promise.all([
      input.onRespondToApproval(shown.requestId, plan.decision, plan.feedback),
      wait(FLASH_MS),
    ]).then(([response]) => {
      if (response?._tag !== "Success") {
        setFeedback(null);
        return;
      }
      // The reason was used; a draft edited since stays.
      const store = useComposerDraftStore.getState();
      if (reason !== null && store.getComposerDraft(target)?.prompt === text) {
        store.setPrompt(target, "");
      }
      if (followUp) setNotes((current) => [...current, { target, text: followUp }]);
      setFeedback({ ...view, result: plan.decision });
      void wait(RESULT_MS).then(() => setFeedback(null));
    });
  };

  // The message waits with the reasons until no request is open, then sends.
  const hold = () => {
    const text = promptRef.current;
    if (text.trim()) {
      setNotes((current) => [...current, { target: composerDraftTarget, text }]);
      promptRef.current = "";
      useComposerDraftStore.getState().setPrompt(composerDraftTarget, "");
    }
    setHolds((count) => count + 1);
  };

  const blocked = pendingApprovals.some((pending) => pending.responseCapability === "live");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- an open request blocks the agent from taking a message, so reasons wait until none is open
  useEffect(() => {
    if (notes.length === 0 || blocked) return;
    // oxlint-disable-next-line react/set-state-in-effect -- the reasons send once; clearing them here is what stops a second send.
    setNotes([]);
    for (const note of notes) {
      if (composerTargetKey(note.target) !== hereKey) putNoteInDraft(note.target, note.text);
    }
    const text = notes
      .filter((note) => composerTargetKey(note.target) === hereKey)
      .map((note) => note.text)
      .join("\n\n");
    if (!text) return;
    const store = useComposerDraftStore.getState();
    if ((store.getComposerDraft(composerDraftTarget)?.prompt ?? "").trim() !== "") {
      putNoteInDraft(composerDraftTarget, text);
      return;
    }
    promptRef.current = text;
    store.setPrompt(composerDraftTarget, text);
    sendNote();
  }, [notes, blocked, composerDraftTarget, hereKey, promptRef, sendNote]);
  const notesRef = useRef(notes);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the unmount below reads the reasons still waiting
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reasons still waiting when the composer goes away go back in their drafts, so none is lost
  useEffect(
    () => () => {
      for (const note of notesRef.current) putNoteInDraft(note.target, note.text);
    },
    [],
  );

  const onVimKey = useStableCallback((key: string) => {
    if (key === "j" || key === "k") {
      update({ type: "move", delta: key === "j" ? 1 : -1 });
      return true;
    }
    if (key >= "1" && key <= "9") {
      const index = Number(key) - 1;
      if (index < options.length) {
        update({ type: "pick", index });
        run(index);
      }
      return true;
    }
    return false;
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands the prompt's keys to the editor's vim plugin while a request waits
  useEffect(() => {
    const editor = editorRef.current;
    if (!active || !editor) return;
    editor.setVimNormalKeyInterceptor(onVimKey);
    return () => editor.setVimNormalKeyInterceptor(null);
  }, [active, editorRef, onVimKey]);

  const label = options.find((option) => option.decision === state.reasonFor)?.label;
  return {
    view:
      feedback ??
      (shown
        ? {
            approval: shown,
            options,
            state,
            position: { index: 0, total: pendingApprovals.length },
            flashIndex: null,
            result: null,
            hint,
          }
        : null),
    disabled:
      !input.canOperate ||
      feedback !== null ||
      (shown !== null && input.respondingRequestIds.includes(shown.requestId)),
    placeholder: active && label ? `Reason to ${label.toLowerCase()}…` : null,
    onRun: (index: number) => {
      update({ type: "pick", index });
      run(index);
    },
    focusComposer: () => editorRef.current?.focus(),
    /** Takes a send while a request is shown, so text is its reason. */
    onSubmit: (): boolean => {
      // Holds a send while the answer lands, and while the next request waits behind its result.
      if (feedback !== null && (feedback.result === null || shown !== null)) return true;
      if (answerable && (carried || !armed)) {
        hold();
        return true;
      }
      if (!active) return false;
      run(null);
      return true;
    },
    onKey: (key: string, event: KeyboardEvent): boolean => {
      if (event.isComposing || event.altKey || event.metaKey || event.ctrlKey) return false;
      const empty = promptRef.current.trim() === "";
      if (feedback !== null) return empty && key === "Enter";
      if (!active || !empty || event.shiftKey) return false;
      if (key === "Enter") {
        run(null);
        return true;
      }
      if (key === "ArrowUp" || key === "ArrowDown") {
        update({ type: "move", delta: key === "ArrowUp" ? -1 : 1 });
        return true;
      }
      if (key === "Tab") {
        update({ type: "bindReason" });
        editorRef.current?.setVimMode("insert");
        return true;
      }
      return false;
    },
  };
}
