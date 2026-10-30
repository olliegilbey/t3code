import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useEffect } from "react";
import { useRightPanelStore } from "../rightPanelStore";
import { useTerminalMode } from "../terminalMode";

// The panel store drops a thread's entry when its last tab closes, so it cannot remember
// that the default was already offered. This list does, so a closed diff stays closed.
const OFFERED_STORAGE_KEY = "t3code:terminal-default-diff:v1";
const MAX_OFFERED_THREADS = 500;

function readOfferedThreadKeys(): string[] {
  try {
    const parsed: unknown = JSON.parse(
      globalThis.localStorage?.getItem(OFFERED_STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === "string")
      : [];
  } catch {
    return [];
  }
}

function markOffered(threadKey: string, offered: ReadonlyArray<string>): void {
  try {
    globalThis.localStorage?.setItem(
      OFFERED_STORAGE_KEY,
      JSON.stringify([...offered, threadKey].slice(-MAX_OFFERED_THREADS)),
    );
  } catch {}
}

/** Terminal mode opens the diff the first time each git thread is shown. */
export function useDefaultDiffPanel(input: {
  // Null for drafts, which have no diff yet.
  readonly threadRef: ScopedThreadRef | null;
  readonly isGitRepo: boolean | undefined;
  readonly enabled: boolean;
}) {
  const terminalMode = useTerminalMode();
  const { threadRef, isGitRepo, enabled } = input;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes the persisted right panel store once per thread when it is first shown
  useEffect(() => {
    if (!terminalMode || !enabled || threadRef === null || isGitRepo !== true) return;
    const threadKey = scopedThreadKey(threadRef);
    const offered = readOfferedThreadKeys();
    if (offered.includes(threadKey)) return;
    markOffered(threadKey, offered);
    const panels = useRightPanelStore.getState();
    // A thread whose panel the user already arranged keeps that arrangement.
    if (threadKey in panels.byThreadKey) return;
    panels.open(threadRef, "diff");
  }, [terminalMode, enabled, threadRef, isGitRepo]);
}
