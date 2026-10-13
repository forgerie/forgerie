import { useState } from "react";
import { AlertCard } from "./AlertCard";

export const name = "Alert card";
export const note = "Something failed and may need the reader";

const recent = "> vite preview --port 4318\nsh: ./node_modules/.bin/vite: No such file or directory";

function Toggle({ open = false }: { open?: boolean }) {
  const [output, setOutput] = useState<string | undefined>(open ? recent : undefined);
  return <AlertCard label="Process failed" subject="oe-preview" title="failed" time="21:06" codeLabel="Command"
    code="cd /tmp/option-e-example && ./node_modules/.bin/vite preview --port 4318"
    output={output} outputLabel="Recent output"
    actions={[{ label: output === undefined ? "Show output" : "Hide output", expanded: output !== undefined,
      onPress: () => setOutput((current) => current === undefined ? recent : undefined) }]}>
    Exit code <strong>127</strong> after 0s. The shell could not find the command.
  </AlertCard>;
}

export default function Failed() {
  return <Toggle />;
}
export function OutputShown() {
  return <Toggle open />;
}
export function NoActions() {
  return <AlertCard label="Process failed" subject="build" title="failed" codeLabel="Command" code="npm run build">Exit code <strong>1</strong>.</AlertCard>;
}
export function TitleOnly() {
  return <AlertCard label="Meters stopped" title="Meters stopped">The meters hit an error and stopped drawing.</AlertCard>;
}
export function Warn() {
  return <AlertCard label="Connection lost" tone="warn" title="The live connection dropped"
    actions={[{ label: "Try now", onPress: () => undefined }]}>
    Live connection timed out. Try <strong>4</strong> starts in 3 s. Your draft stays here.
  </AlertCard>;
}
/** A long error cut to a few lines, with Show more. */
export function CutError() {
  return <AlertCard label="Run failed" subject="Failed" title="The Oct 12, 3:00 AM run failed." codeLabel="Error" codeLines={4}
    code={'Workflow "refine-backlog" was not found in /home/reader/code/forgerie.\nThe library lists: release-notes, triage-issues.\nChecked .forgerie/workflows and ~/.forgerie/workflows.\nRename the workflow or choose another one on the trigger page.\nThe trigger keeps its schedule.\nThe next run tries again.'}
    actions={[{ label: "Mark as seen", onPress: () => undefined }, { label: "Run now…", onPress: () => undefined }]}>
    Fix the cause, then run it now or wait for the next run.
  </AlertCard>;
}
