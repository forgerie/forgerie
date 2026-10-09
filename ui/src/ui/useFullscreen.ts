import { useCallback, useSyncExternalStore } from "react";
import { fullscreenState, toggleFullscreen, type FullscreenState } from "../appFullscreen";

const subscribe = (onChange: () => void) => {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
};
// A string snapshot: useSyncExternalStore compares by identity.
const snapshot = () => fullscreenState(document).type;

/** The document's full-screen state, and the toggle the reader presses. */
export function useFullscreen(): { state: FullscreenState; toggle: () => void } {
  const type = useSyncExternalStore(subscribe, snapshot, () => "unsupported" as const);
  const toggle = useCallback(() => {
    // A refusal (no user gesture, a policy) leaves the app as it was; there is nothing to recover.
    toggleFullscreen({ type }, document).catch(() => undefined);
  }, [type]);
  return { state: { type }, toggle };
}
