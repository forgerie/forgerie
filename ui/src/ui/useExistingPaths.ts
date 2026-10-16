import { useEffect, useState } from "react";

/** How file names in a reply become links: which of them exist, and what a tap on one does. */
export interface FileLinks {
  /** The paths, of those asked for, that name a file that exists now. */
  existing: (paths: readonly string[], signal: AbortSignal) => Promise<ReadonlySet<string>>;
  open: (path: string) => void;
}

/** How long the names must stay the same before they are looked up. A streamed block changes on every token. */
export const FILE_CHECK_DELAY_MS = 250;
const NONE: ReadonlySet<string> = new Set();

/**
 * The paths, of `paths`, that exist, once the list has been still for
 * `FILE_CHECK_DELAY_MS`. Empty without `links`, and empty again while a
 * changed list waits for its answer, so a stale answer never links a name.
 */
export function useExistingPaths(paths: readonly string[], links: FileLinks | undefined): ReadonlySet<string> {
  const [checked, setChecked] = useState<{ key: string; found: ReadonlySet<string> }>();
  const key = links ? paths.join("\n") : "";
  useEffect(() => {
    if (!links || key === "") return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      links.existing(key.split("\n"), controller.signal).then(
        (existing) => { if (!controller.signal.aborted) setChecked({ key, found: existing }); },
        () => undefined);
    }, FILE_CHECK_DELAY_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [links, key]);
  return checked?.key === key && key !== "" ? checked.found : NONE;
}
