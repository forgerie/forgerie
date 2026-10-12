import { useEffect, useReducer } from "react";

/**
 * One value that changes while the components that show it keep their
 * identity. A list that remounts its rows whenever a render function changes
 * loses each row's local state (a request in flight, an error); a row that
 * reads the function from here keeps it and draws again when it changes.
 */
export interface Latest<T> { get: () => T; set: (value: T) => void; subscribe: (listener: () => void) => () => void }

export function createLatest<T>(initial: T): Latest<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

/** The current value, drawn again each time it changes. */
export function useLatest<T>(latest: Latest<T>): T {
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const value = latest.get();
  useEffect(() => {
    const stop = latest.subscribe(redraw);
    // A change between this draw and the subscription would otherwise be missed.
    if (!Object.is(latest.get(), value)) redraw();
    return stop;
  }, [latest, value]);
  return value;
}
