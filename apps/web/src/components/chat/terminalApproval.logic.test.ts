import type { ProviderApprovalOption } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  initialTerminalApprovalState,
  orderApprovalOptions,
  planApprovalResponse,
  reduceTerminalApproval,
  resolveTerminalApprovalSubmit,
} from "./terminalApproval.logic";

const accept = { decision: "accept", label: "Approve" } satisfies ProviderApprovalOption;
const session = {
  decision: "acceptForSession",
  label: "Always allow this session",
} satisfies ProviderApprovalOption;
const decline = { decision: "decline", label: "Decline" } satisfies ProviderApprovalOption;
const cancel = { decision: "cancel", label: "Cancel" } satisfies ProviderApprovalOption;

const options = orderApprovalOptions([decline, accept, cancel, session]);

describe("orderApprovalOptions", () => {
  it("orders options as accept, session, always, decline, cancel", () => {
    expect(options.map((option) => option.decision)).toEqual([
      "accept",
      "acceptForSession",
      "decline",
      "cancel",
    ]);
    expect(orderApprovalOptions(undefined).map((option) => option.decision)).toEqual([
      "accept",
      "acceptForSession",
      "decline",
      "cancel",
    ]);
  });
});

describe("reduceTerminalApproval", () => {
  it("selects Approve first, or the first option when there is no Approve", () => {
    expect(initialTerminalApprovalState(options)).toEqual({ selected: 0, reasonFor: null });
    expect(initialTerminalApprovalState([session, accept])).toEqual({
      selected: 1,
      reasonFor: null,
    });
    expect(initialTerminalApprovalState([decline, cancel])).toEqual({
      selected: 0,
      reasonFor: null,
    });
  });

  it("move clamps at both ends", () => {
    const first = { selected: 0, reasonFor: null };
    const last = { selected: options.length - 1, reasonFor: null };
    expect(reduceTerminalApproval(first, { type: "move", delta: -1 }, options)).toEqual(first);
    expect(reduceTerminalApproval(first, { type: "move", delta: 1 }, options).selected).toBe(1);
    expect(reduceTerminalApproval(last, { type: "move", delta: 1 }, options)).toEqual(last);
  });

  it("pick selects an index in range and ignores out-of-range", () => {
    const state = { selected: 0, reasonFor: null };
    expect(reduceTerminalApproval(state, { type: "pick", index: 2 }, options).selected).toBe(2);
    expect(reduceTerminalApproval(state, { type: "pick", index: 4 }, options)).toEqual(state);
    expect(reduceTerminalApproval(state, { type: "pick", index: -1 }, options)).toEqual(state);
  });

  it("typing without Tab binds the reason to Decline", () => {
    const state = reduceTerminalApproval(
      { selected: 0, reasonFor: null },
      { type: "draft", empty: false },
      options,
    );
    expect(state).toEqual({ selected: 2, reasonFor: "decline" });
  });

  it("Tab binds the reason to the selected option", () => {
    const bound = reduceTerminalApproval(
      { selected: 0, reasonFor: null },
      { type: "bindReason" },
      options,
    );
    expect(bound).toEqual({ selected: 0, reasonFor: "accept" });
    expect(reduceTerminalApproval(bound, { type: "draft", empty: false }, options)).toEqual(bound);
  });

  it("emptying the draft drops the binding and keeps the selection", () => {
    expect(
      reduceTerminalApproval(
        { selected: 2, reasonFor: "decline" },
        { type: "draft", empty: true },
        options,
      ),
    ).toEqual({ selected: 2, reasonFor: null });
  });
});

describe("resolveTerminalApprovalSubmit", () => {
  it("submit with empty text runs the selected option", () => {
    expect(resolveTerminalApprovalSubmit({ selected: 1, reasonFor: null }, options, "  ")).toEqual({
      decision: "acceptForSession",
      reason: null,
    });
  });

  it("submit with text runs the reason's option", () => {
    expect(
      resolveTerminalApprovalSubmit({ selected: 0, reasonFor: "accept" }, options, " why "),
    ).toEqual({ decision: "accept", reason: "why" });
    expect(
      resolveTerminalApprovalSubmit({ selected: 0, reasonFor: null }, options, "no thanks"),
    ).toEqual({ decision: "decline", reason: "no thanks" });
  });
});

describe("planApprovalResponse", () => {
  it("plan: decline with reason and feedback support sends feedback", () => {
    expect(planApprovalResponse("decline", "r", true)).toEqual({
      decision: "decline",
      feedback: "r",
    });
  });

  it("plan: decline with reason and no feedback support declines then follows up", () => {
    expect(planApprovalResponse("decline", "r", false)).toEqual({
      decision: "decline",
      followUp: "r",
    });
  });

  it("plan: approve with reason approves then follows up", () => {
    expect(planApprovalResponse("accept", "r", true)).toEqual({
      decision: "accept",
      followUp: "r",
    });
    expect(planApprovalResponse("acceptForSession", "r", true)).toEqual({
      decision: "acceptForSession",
      followUp: "r",
    });
  });

  it("plan: no reason sends the bare decision", () => {
    expect(planApprovalResponse("accept", null, true)).toEqual({ decision: "accept" });
    expect(planApprovalResponse("decline", null, true)).toEqual({ decision: "decline" });
  });
});
