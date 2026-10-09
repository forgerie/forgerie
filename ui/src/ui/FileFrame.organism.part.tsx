import { useState } from "react";
import { InfoIcon, LockIcon } from "lucide-react";
import { CodeEditor } from "./CodeEditor";
import { Consequence } from "./Consequence";
import { FactList } from "./FactList";
import { FileFrame } from "./FileFrame";

export const name = "File frame";
export const note = "One file to read or edit, with its facts and notices above it";
export const composition = { default: [
  { part: "src/ui/FactList.molecule.part.tsx", state: "default" },
  { part: "src/ui/Consequence.molecule.part.tsx", state: "default" },
  { part: "src/ui/CodeEditor.molecule.part.tsx", state: "default" },
] };

const README = "# Acme sign-in\n\nThe sign-in form and the SSO callback share one validator.\n\n## Develop\n\n```sh\nnpm install\nnpm run dev\n```\n";

export default function Editable() {
  const [text, setText] = useState(README);
  return <FileFrame facts={<FactList code={"Lives in: The repo\nFile: `docs/README.md`"} />}
    notices={[<Consequence key="save" icon={<InfoIcon />}>{text === README ? "Saving writes the file." : "Unsaved edits. Saving writes the file."}</Consequence>]}>
    <CodeEditor label="Edit README.md" fileName="README.md" text={README} onChange={setText} onSave={() => undefined} />
  </FileFrame>;
}
export function ReadOnly() {
  return <FileFrame facts={<FactList code={"Lives in: A package\nFile: `node_modules/acme/README.md`"} />}
    notices={[<Consequence key="lock" icon={<LockIcon />}>An update replaces this file, so it is read-only here.</Consequence>]}>
    <CodeEditor label="Read README.md" fileName="README.md" text={README} readOnly onChange={() => undefined} onSave={() => undefined} />
  </FileFrame>;
}
