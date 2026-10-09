import { useState } from "react";
import { AlertCard } from "./AlertCard";

export const name = "Alert card";
export const note = "Something failed and may need the reader";

export default function Failed() {
  const [output, setOutput] = useState<string | undefined>(undefined);
  return <AlertCard label="Process failed" title="oe-preview failed" time="21:06" codeLabel="Command"
    code="cd /tmp/option-e-example && ./node_modules/.bin/vite preview --port 4318"
    output={output} outputLabel="Recent output"
    actions={[{ label: output === undefined ? "Show output" : "Hide output",
      onPress: () => setOutput((current) => current === undefined ? "sh: ./node_modules/.bin/vite: No such file or directory" : undefined) }]}>
    Exit code <strong>127</strong> after 0s. The shell could not find the command.
  </AlertCard>;
}
export function NoActions() {
  return <AlertCard label="Process failed" title="build" codeLabel="Command" code="npm run build">Exit code <strong>1</strong>.</AlertCard>;
}
