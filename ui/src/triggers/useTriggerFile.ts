import { useCallback, useEffect, useState } from "react";
import type { TriggerFileDocument } from "@shared/triggerFiles";
import { TriggerRefusal, type TriggersApi } from "./triggersApi";
import type { TriggerFileLoad, TriggerVersionsLoad } from "./TriggerFilePage";

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * Binding: one trigger's workflow file and the versions Forgerie kept of it. Both are read when the page opens and
 * each time `seen` changes, such as on `triggers.changed`, so a change made outside Forgerie shows. A reread that
 * fails keeps the file it had. `id` undefined reads nothing.
 */
export function useTriggerFile(api: Pick<TriggersApi, "file" | "versions">, id: string | undefined, seen: unknown) {
  const [file, setFile] = useState<{ id: string; load: TriggerFileLoad }>();
  const [versions, setVersions] = useState<{ id: string; load: TriggerVersionsLoad }>();
  const read = useCallback((target: string, signal?: AbortSignal) => {
    api.file(target, signal).then((document) => { if (!signal?.aborted) setFile({ id: target, load: { type: "ready", document } }); },
      (error: unknown) => {
        if (signal?.aborted) return;
        const gone = error instanceof TriggerRefusal && error.status === 404;
        setFile((previous) => !gone && previous?.id === target && previous.load.type === "ready" ? previous
          : { id: target, load: gone ? { type: "gone" } : { type: "failed", message: messageOf(error) } });
      });
    api.versions(target, signal).then((value) => { if (!signal?.aborted) setVersions({ id: target, load: { type: "ready", versions: value.versions } }); },
      (error: unknown) => {
        if (signal?.aborted) return;
        setVersions((previous) => previous?.id === target && previous.load.type === "ready" ? previous : { id: target, load: { type: "failed", message: messageOf(error) } });
      });
  }, [api]);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    read(id, controller.signal);
    return () => controller.abort();
  }, [id, read, seen]);
  return {
    file: file && file.id === id ? file.load : { type: "loading" } as TriggerFileLoad,
    versions: versions && versions.id === id ? versions.load : { type: "loading" } as TriggerVersionsLoad,
    /** Read the file and its versions again. */
    reread: useCallback(() => { if (id) read(id); }, [id, read]),
    /** The file as a save returned it, without another read. Its versions are read again. */
    saved: useCallback((target: string, document: TriggerFileDocument) => { setFile({ id: target, load: { type: "ready", document } }); read(target); }, [read]),
  };
}
