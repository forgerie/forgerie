import { useState } from "react";
import type { ManagedProcessWriteResult } from "@shared/apiTypes";
import { SheetDialog } from "../ui/SheetDialog";
import { StatusRow } from "../ui/StatusRow";
import { NoticeBar } from "../ui/NoticeBar";
import { ReplyBox } from "../ui/ReplyBox";
import { CommandBlock } from "../ui/CommandBlock";
import { EventLine } from "../ui/EventLine";
import { ActionFooter } from "../ui/ActionFooter";
import { Lede } from "../ui/Lede";
import type { ProcessesState } from "./processesStore";
import { processMeta, processStatus, processTone } from "./processRow";

/** The draft an empty list puts in the message box. The reader finishes it and sends it. */
export const START_PROCESS_DRAFT = "Use the process tool to start ";

/**
 * Shape: the session's managed processes. The list leads each row with a dot in the process's tone, the command
 * under its name, and the pid and uptime, or how long ago it ended. An empty list says what will show here and
 * offers a draft that asks the agent to start one. A process's own view gives its facts, then its log with stderr
 * lines tinted, then stdin while it runs; Stop sits in the header in the danger tone.
 */
export function ProcessesPanel({ state, onSelect, onStop, onWrite, onRefresh, onClose, onAsk, now: clock = Date.now }: {
  state: ProcessesState;
  onSelect: (id: string | undefined) => void;
  onStop: (id: string) => void;
  onWrite: (id: string, input: string, end?: boolean) => Promise<ManagedProcessWriteResult>;
  onRefresh: () => void;
  onClose: () => void;
  /** Puts text in the message box. Absent: the empty list offers no draft. */
  onAsk?: ((text: string) => void) | undefined;
  now?: () => number;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [inputError, setInputError] = useState<string>();
  const snapshot = state.view.kind === "ready" ? state.view.snapshot : undefined;
  const process = snapshot?.processes.find(item => item.id === state.selected);
  const running = process?.status === "running";
  const error = state.error ?? state.readError ?? (state.view.kind === "failed" ? state.view.error : undefined);
  const now = clock();
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
  const processes = snapshot?.processes ?? [];
  const runningCount = processes.filter(item => item.status === "running").length;
  const empty = snapshot?.available === true && processes.length === 0;
  const subtitle = process ? processStatus(process)
    : snapshot === undefined || !snapshot.available ? undefined
    : processes.length === 0 ? "None yet" : `${String(processes.length)} in this session, ${runningCount === 0 ? "none" : String(runningCount)} running`;
  const footer = running && snapshot?.writeSupported ? <ReplyBox label={`Stdin for ${process.name}`} placeholder="Text sent exactly as entered; add a newline if needed" sendLabel="Write stdin"
      disabled={state.pending} onSend={text => write(text)} draft={{ value: drafts[process.id] ?? "", update: change => setDrafts(current => ({ ...current, [process.id]: change(current[process.id] ?? "") })) }}
      secondary={{ label: "Close stdin", disabled: state.pending, onPress: () => { void write("", true).catch(() => undefined); } }} />
    : !process && empty && onAsk ? <ActionFooter actions={[{ label: "Ask the agent to start one", onPress: () => { onClose(); onAsk(START_PROCESS_DRAFT); } }]} />
    : undefined;
  return <SheetDialog title={process?.name ?? "Managed processes"} closeLabel="Close managed processes" onClose={onClose}
    subtitle={subtitle} back={process ? { label: "All managed processes", onPress: () => onSelect(undefined) } : undefined}
    actions={[{ label: "Refresh", onPress: onRefresh }, ...(running ? [{ label: "Stop", tone: "danger" as const, onPress: () => onStop(process.id), disabled: state.pending }] : [])]}
    footer={footer}>
    {inputError && <NoticeBar tone="alert" message={inputError} actions={[]} />}
    {error && <NoticeBar tone="alert" message={error} actions={[]} />}
    {process ? <>
      {process.notice && <NoticeBar tone="plain" message={process.notice} actions={[]} />}
      {process.errorMessage && <NoticeBar tone="alert" message={process.errorMessage} actions={[]} />}
      <EventLine tone="neutral" subject={process.name} phrase={processStatus(process)} code={process.command} codeLabel="Command"
        facts={[{ label: "cwd", value: process.cwd }, ...(process.pid > 0 ? [{ label: "pid", value: String(process.pid) }] : []),
          { label: "started", value: new Date(process.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }]} />
      <p>stdout and stderr share one ordered log.{state.stderr && state.stderr.length > 0 ? " Lines from stderr are tinted." : ""}</p>
      <CommandBlock code={state.output ?? "Reading output…"} label={`Output of ${process.name}`} copyLabel="Copy process output" marked={state.stderr} />
    </> : state.view.kind === "loading" ? <p role="status">Reading managed processes…</p>
      : snapshot?.available === false ? <p>Managed processes are unavailable in this session.</p>
      : empty ? <Lede>Nothing runs for this session yet. When the agent starts a long command with the process tool, such as <code>npm run dev</code> for a dev
        server, <code>npx vitest --watch</code> for tests that run again on every change, or <code>nix build</code>, it shows here. You can read its output,
        type into it, and stop it. It keeps running when Forgerie restarts, and stops when this session closes.</Lede>
      : processes.map(item => <StatusRow key={item.id} name={item.name} status={processStatus(item)} meta={processMeta(item, now)}
        tone={processTone(item)} label={`Open ${item.name}`} onPress={() => onSelect(item.id)}
        below={<><p><code title={item.command}>{item.command}</code></p>{item.lastLogLine && <>
          <CommandBlock code={item.lastLogLine.text} label={`Last output of ${item.name}`} copyLabel={`Copy last output of ${item.name}`}
            lines={2} moreLabel="Show full output line" />
          {item.lastLogLine.truncatedStart && <p>Beginning of output line omitted.</p>}
        </>}
          {item.notice && <p>{item.notice}</p>}{item.errorMessage && <p>{item.errorMessage}</p>}</>} />)}
  </SheetDialog>;
}
