import { resolve } from "node:path";

/**
 * Items grouped by working directory, compared the way cwdPathsEqual compares them.
 * Filtering a list once per cwd resolved every path for every cwd; on a machine with
 * thousands of sessions in over a hundred folders that dominated the session catalog.
 * Each path is resolved once here. A lookup keeps the items' original order.
 */
export function groupByCwd<T>(items: readonly T[], cwdOf: (item: T) => string): { get(cwd: string): T[] } {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = resolve(cwdOf(item));
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [item]);
    else group.push(item);
  }
  return { get: (cwd) => groups.get(resolve(cwd)) ?? [] };
}
