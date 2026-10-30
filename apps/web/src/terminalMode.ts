import { useSyncExternalStore } from "react";

/** A per-device on/off setting, mirrored to an attribute on `<html>` for CSS. */
function createLocalFlag(storageKey: string, attribute: string) {
  const listeners = new Set<() => void>();
  const read = (): boolean => {
    try {
      return globalThis.localStorage?.getItem(storageKey) === "true";
    } catch {
      return false;
    }
  };
  let enabled = read();
  const applyAttribute = (): void => {
    if (typeof document === "undefined") return;
    document.documentElement.toggleAttribute(attribute, enabled);
  };
  const publish = (next: boolean): void => {
    if (next === enabled) return;
    enabled = next;
    applyAttribute();
    for (const listener of listeners) listener();
  };
  applyAttribute();
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (event) => {
      if (event.key === storageKey || event.key === null) publish(read());
    });
  }
  return {
    get: (): boolean => enabled,
    set: (next: boolean): void => {
      try {
        if (next) globalThis.localStorage?.setItem(storageKey, "true");
        else globalThis.localStorage?.removeItem(storageKey);
      } catch {}
      publish(next);
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// Lives beside the theme keys so index.html can set the attribute before first paint.
const terminalMode = createLocalFlag("t3code:terminal-mode", "data-terminal-mode");
const vimKeys = createLocalFlag("t3code:vim-keys", "data-vim-keys");

export const isTerminalModeEnabled = terminalMode.get;
export const setTerminalModeEnabled = terminalMode.set;
export const subscribeTerminalMode = terminalMode.subscribe;

export function useTerminalMode(): boolean {
  return useSyncExternalStore(terminalMode.subscribe, terminalMode.get, () => false);
}

export const setVimKeysEnabled = vimKeys.set;

/** The vim keys switch itself, which only takes effect in Terminal mode. */
export function useVimKeysSetting(): boolean {
  return useSyncExternalStore(vimKeys.subscribe, vimKeys.get, () => false);
}

/** Whether the composer takes vim keys right now. */
export function vimKeysActive(): boolean {
  return terminalMode.get() && vimKeys.get();
}

export function useVimKeys(): boolean {
  const terminal = useTerminalMode();
  const vim = useVimKeysSetting();
  return terminal && vim;
}
