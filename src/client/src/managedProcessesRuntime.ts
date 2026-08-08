import type { ManagedProcessesBrowserEvent, ManagedProcessesRuntime, ManagedProcessesSession } from "../../plugin-api/unstable";
import type { ManagedProcessKillResult, ManagedProcessOutputResult, ManagedProcessesSnapshot, ManagedProcessWriteResult, SessionRef } from "../../shared/apiTypes";

export interface ManagedProcessesApi {
  processes(session: SessionRef, machineId?: string): Promise<ManagedProcessesSnapshot>;
  processOutput(session: SessionRef, processId: string, tailLines?: number, machineId?: string): Promise<ManagedProcessOutputResult>;
  killProcess(session: SessionRef, processId: string, machineId?: string): Promise<ManagedProcessKillResult>;
  writeProcess(session: SessionRef, processId: string, input: string, machineId?: string): Promise<ManagedProcessWriteResult>;
}

export type ManagedProcessesSubscribe = (listener: (event: ManagedProcessesBrowserEvent) => void) => () => void;

export interface ManagedProcessesSnapshotCache {
  read(): ManagedProcessesSnapshot | undefined;
  write(snapshot: ManagedProcessesSnapshot): void;
}

export function createManagedProcessesRuntime(
  selectedSession: ManagedProcessesSession | undefined,
  api: ManagedProcessesApi,
  subscribe: ManagedProcessesSubscribe,
  cache?: ManagedProcessesSnapshotCache,
): ManagedProcessesRuntime {
  const session = selectedSession === undefined ? undefined : { id: selectedSession.id, cwd: selectedSession.cwd };
  const machineId = selectedSession?.machineId;
  return {
    selectedSession,
    currentSnapshot: () => cache?.read(),
    snapshot: async () => {
      const snapshot = session === undefined
        ? { available: false, writeSupported: false, processes: [] }
        : await api.processes(session, machineId);
      cache?.write(snapshot);
      return snapshot;
    },
    output: (id, tailLines) => session === undefined
      ? Promise.resolve({ ok: false, reason: "unavailable" })
      : api.processOutput(session, id, tailLines, machineId),
    kill: (id) => session === undefined
      ? Promise.resolve({ ok: false, reason: "unavailable" })
      : api.killProcess(session, id, machineId),
    write: (id, data) => session === undefined
      ? Promise.resolve({ ok: false, reason: "unavailable" })
      : api.writeProcess(session, id, data, machineId),
    subscribe,
  };
}
