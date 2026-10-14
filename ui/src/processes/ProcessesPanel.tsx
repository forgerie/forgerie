import { useState } from "react";
import type { ManagedProcessInfo, ManagedProcessWriteResult } from "@shared/apiTypes";
import { SheetDialog } from "../ui/SheetDialog";
import { StatusRow } from "../ui/StatusRow";
import { NoticeBar } from "../ui/NoticeBar";
import { ReplyBox } from "../ui/ReplyBox";
import { CommandBlock } from "../ui/CommandBlock";
import { EventLine } from "../ui/EventLine";
import type { ProcessesState } from "./processesStore";

const statusLabels = {
  running: "Running", terminating: "Terminating", terminate_timeout: "Termination timed out", exited: "Exited", killed: "Killed",
} satisfies Record<ManagedProcessInfo["status"], string>;
const statusLabel = (process: ManagedProcessInfo) => process.endReason === "lost" ? "Lost" : statusLabels[process.status];

export function ProcessesPanel({ state, onSelect, onStop, onWrite, onRefresh, onClose }: {
  state: ProcessesState;
  onSelect: (id: string | undefined) => void;
  onStop: (id: string) => void;
  onWrite: (id: string, input: string, end?: boolean) => Promise<ManagedProcessWriteResult>;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [inputError, setInputError] = useState<string>();
  const snapshot = state.view.kind === "ready" ? state.view.snapshot : undefined;
  const process = snapshot?.processes.find(item => item.id === state.selected);
  const running = process?.status === "running";
  const error = state.error ?? state.readError ?? (state.view.kind === "failed" ? state.view.error : undefined);
  const write = async (input: string, end = false) => {
    if (!process) return;
    setInputError(undefined);
    const result = await onWrite(process.id, input, end);
    if (!result.ok) {
      // A partial FIFO write is not safe to resend. Keep only the unwritten byte suffix.
      if (result.bytesWritten !== undefined) {
        let remaining = "";
        try { remaining = new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(input).slice(result.bytesWritten)); }
        catch { setInputError("The partial write split a UTF-8 character. The draft was cleared to prevent sending damaged text. Inspect the process before writing again."); }
        setDrafts(current => ({ ...current, [process.id]: remaining }));
      }
      throw new Error("Stdin write did not complete");
    }
  };
  return <SheetDialog title={process?.name ?? "Managed processes"} closeLabel="Close managed processes" onClose={onClose}
    subtitle={process ? statusLabel(process) : undefined} back={process ? { label: "All managed processes", onPress: () => onSelect(undefined) } : undefined}
    actions={[{ label: "Refresh", onPress: onRefresh }, ...(running ? [{ label: "Stop", onPress: () => onStop(process.id), disabled: state.pending }] : [])]}
    footer={running && snapshot?.writeSupported ? <ReplyBox label={`Stdin for ${process.name}`} placeholder="Text sent exactly as entered; add a newline if needed" sendLabel="Write stdin"
      disabled={state.pending} onSend={text => write(text)} draft={{ value: drafts[process.id] ?? "", update: change => setDrafts(current => ({ ...current, [process.id]: change(current[process.id] ?? "") })) }}
      secondary={{ label: "Close stdin", disabled: state.pending, onPress: () => { void write("", true).catch(() => undefined); } }} /> : undefined}>
    {inputError && <NoticeBar tone="alert" message={inputError} actions={[]} />}
    {error && <NoticeBar tone="alert" message={error} actions={[]} />}
    {process ? <>
      {process.notice && <NoticeBar tone="plain" message={process.notice} actions={[]} />}
      {process.errorMessage && <NoticeBar tone="alert" message={process.errorMessage} actions={[]} />}
      <EventLine tone="neutral" subject={process.name} phrase={statusLabel(process)} code={process.command} codeLabel="Command" facts={[{ label: "cwd", value: process.cwd }]} />
      <p>stdout and stderr share one ordered log.</p>
      <CommandBlock code={state.output ?? "Reading output…"} label={`Output of ${process.name}`} copyLabel="Copy process output" />
    </> : state.view.kind === "loading" ? <p role="status">Reading managed processes…</p>
      : snapshot?.available === false ? <p>Managed processes are unavailable in this session.</p>
      : snapshot?.processes.length === 0 ? <p>No managed processes yet. The agent can start one with the process tool.</p>
      : snapshot?.processes.map(item => <StatusRow key={item.id} name={item.name} status={statusLabel(item)}
        tone={item.status === "running" ? "working" : "quiet"} label={`Open ${item.name}`} onPress={() => onSelect(item.id)}
        below={<>{item.notice && <p>{item.notice}</p>}{item.errorMessage && <p>{item.errorMessage}</p>}</>} />)}
  </SheetDialog>;
}
