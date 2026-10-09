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
