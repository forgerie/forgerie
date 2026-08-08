import type { TerminalCommandRun, TerminalCommandRunFilter, TerminalCommandRunHandle, Workspace, WorkspaceTerminalCommandInput } from "../plugin-api.js";
import type {
  ManagedProcessKillResult,
  ManagedProcessOutputResult,
  ManagedProcessWriteResult,
  ManagedProcessesSnapshot,
  SessionUiEvent,
} from "../shared/apiTypes.js";

export type {
  ManagedProcessInfo,
  ManagedProcessKillResult,
  ManagedProcessLogLine,
  ManagedProcessOutputResult,
  ManagedProcessStatus,
  ManagedProcessesSnapshot,
  ManagedProcessWriteResult,
} from "../shared/apiTypes.js";

export interface UnstableRunTerminalCommandInput extends WorkspaceTerminalCommandInput {
  workspace: Workspace;
}

export interface UnstableTerminalCommandRunsRuntime {
  runCommand(input: UnstableRunTerminalCommandInput): Promise<TerminalCommandRunHandle>;
  listCommandRuns(filter?: TerminalCommandRunFilter): Promise<TerminalCommandRun[]>;
  getCommandRun(runId: string): Promise<TerminalCommandRun | undefined>;
  open(options?: { terminalId?: string | undefined }): void;
}

export interface ManagedProcessesSession {
  machineId: string;
  id: string;
  cwd: string;
}

export type ManagedProcessesBrowserEvent = Extract<SessionUiEvent, { type: "processes.update" | "processes.output" }> | { type: "processes.refresh" };

export interface ManagedProcessesRuntime {
  readonly selectedSession: ManagedProcessesSession | undefined;
  currentSnapshot(): ManagedProcessesSnapshot | undefined;
  snapshot(): Promise<ManagedProcessesSnapshot>;
  output(id: string, tailLines?: number): Promise<ManagedProcessOutputResult>;
  kill(id: string): Promise<ManagedProcessKillResult>;
  write(id: string, data: string): Promise<ManagedProcessWriteResult>;
  subscribe(listener: (event: ManagedProcessesBrowserEvent) => void): () => void;
}

export interface UnstableRuntimeCapabilities {
  terminalCommandRuns: UnstableTerminalCommandRunsRuntime;
  managedProcesses?: ManagedProcessesRuntime;
  openSettings?: (section?: string) => void;
}

export interface UnstablePluginRuntimeContext {
  piWebUnstable?: UnstableRuntimeCapabilities;
}

export interface UnstableWorkspacePanelContext {
  piWebUnstable?: Pick<UnstableRuntimeCapabilities, "terminalCommandRuns" | "managedProcesses">;
}
