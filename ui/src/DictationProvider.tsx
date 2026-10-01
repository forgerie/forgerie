import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { ForgerieDictationAdapter, type DictationState } from "./speech/ForgerieDictationAdapter";

const idle: DictationState = { type: "idle" };
const DictationContext = createContext<{ state: DictationState; cancel(): void }>({ state: idle, cancel: () => {} });

/** React binding. The adapter remains the sole owner of capture and request state. */
export function DictationProvider({ adapter, children }: { adapter: ForgerieDictationAdapter; children: ReactNode }) {
  const state = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
  useEffect(() => () => adapter.cancel(), [adapter]);
  return <DictationContext.Provider value={{ state, cancel: adapter.cancel }}>{children}</DictationContext.Provider>;
}
export const useDictation = () => useContext(DictationContext);
