import type { ProviderApprovalDecision, ProviderApprovalOption } from "@t3tools/contracts";
import { DEFAULT_APPROVAL_OPTIONS } from "./ComposerPendingApprovalActions";

const DECISION_ORDER: ReadonlyArray<ProviderApprovalDecision> = [
  "accept",
  "acceptForSession",
  "acceptAlways",
  "decline",
  "cancel",
];

export function orderApprovalOptions(
  options: ReadonlyArray<ProviderApprovalOption> | undefined,
): ProviderApprovalOption[] {
  return [...(options ?? DEFAULT_APPROVAL_OPTIONS)].toSorted(
    (a, b) => DECISION_ORDER.indexOf(a.decision) - DECISION_ORDER.indexOf(b.decision),
  );
}

export interface TerminalApprovalState {
  readonly selected: number;
  readonly reasonFor: ProviderApprovalDecision | null;
}

export type TerminalApprovalEvent =
  | { type: "move"; delta: 1 | -1 }
  | { type: "pick"; index: number }
  | { type: "bindReason" }
  | { type: "draft"; empty: boolean };

export function initialTerminalApprovalState(
  options: ReadonlyArray<ProviderApprovalOption>,
): TerminalApprovalState {
  return {
    selected: Math.max(
      0,
      options.findIndex((option) => option.decision === "accept"),
    ),
    reasonFor: null,
  };
}

export function reduceTerminalApproval(
  state: TerminalApprovalState,
  event: TerminalApprovalEvent,
  options: ReadonlyArray<ProviderApprovalOption>,
): TerminalApprovalState {
  switch (event.type) {
    case "move": {
      const selected = Math.min(Math.max(state.selected + event.delta, 0), options.length - 1);
      return selected === state.selected ? state : { ...state, selected };
    }
    case "pick":
      return event.index >= 0 && event.index < options.length
        ? { ...state, selected: event.index }
        : state;
    case "bindReason": {
      const decision = options[state.selected]?.decision;
      return decision ? { ...state, reasonFor: decision } : state;
    }
    case "draft": {
      if (event.empty) return state.reasonFor === null ? state : { ...state, reasonFor: null };
      if (state.reasonFor !== null) return state;
      const declineIndex = options.findIndex((option) => option.decision === "decline");
      return {
        selected: declineIndex === -1 ? state.selected : declineIndex,
        reasonFor: "decline",
      };
    }
  }
}

export function resolveTerminalApprovalSubmit(
  state: TerminalApprovalState,
  options: ReadonlyArray<ProviderApprovalOption>,
  text: string,
): { decision: ProviderApprovalDecision; reason: string | null } {
  const reason = text.trim();
  if (reason.length > 0) return { decision: state.reasonFor ?? "decline", reason };
  return { decision: options[state.selected]?.decision ?? "decline", reason: null };
}

// Only a decline carries feedback to the provider. Any other reason goes as a follow-up message.
export function planApprovalResponse(
  decision: ProviderApprovalDecision,
  reason: string | null,
  supportsFeedback: boolean,
): { decision: ProviderApprovalDecision; feedback?: string; followUp?: string } {
  if (reason === null) return { decision };
  if (decision === "decline" && supportsFeedback) return { decision, feedback: reason };
  return { decision, followUp: reason };
}

const DECIDED = {
  accept: "approved",
  acceptForSession: "approved for this session",
  acceptAlways: "always allowed",
  decline: "declined",
  cancel: "cancelled",
} satisfies Record<ProviderApprovalDecision, string>;

/** A reason given for a subagent's request goes to the parent, which passes it on. */
export function subagentFollowUp(
  title: string,
  approval: { readonly detail?: string; readonly requestKind: string },
  decision: ProviderApprovalDecision,
  reason: string,
): string {
  const text = approval.detail || approval.requestKind;
  const first = text.split("\n", 1)[0] ?? "";
  const request =
    first.length < text.length || first.length > 200 ? `${first.slice(0, 200)}…` : first;
  return `I ${DECIDED[decision]} a request from the subagent "${title}": ${request}\nPass this on to it: ${reason}`;
}
