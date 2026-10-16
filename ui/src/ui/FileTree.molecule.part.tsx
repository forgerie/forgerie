import { useMemo, useState } from "react";
import { FileTree } from "./FileTree";

export const name = "File tree";
export const note = "Files a change touched, marked added, changed or deleted, or a layout with notes";

export default function Change() {
  return <FileTree code={"src/server/sessions/\n  ~ piSessionService.ts # injects the guide\n  + replyFormatGuide.acceptance.test.ts\nui/src/ui/\n  + Checklist.tsx\n  + Checklist.css\n  ~ theme.css # adds block tokens\n- src/server/sessions/replyFormatGuide.ts # moved to src/shared"} />;
}
export function FlatPaths() {
  return <FileTree code={"+ ui/src/ui/Diagram.tsx\n+ ui/src/ui/Diagram.css\n~ ui/package.json"} />;
}
// Every file but ModelPicker.tsx is on disk, so it stays a plain row.
const ON_DISK = new Set(["ui/src/ui/OptionRow.tsx", "ui/src/mentionSource.ts"]);
const existing = async (paths: readonly string[]) => new Set(paths.filter((path) => ON_DISK.has(path)));
export function Openable() {
  const [opened, setOpened] = useState<string>();
  const links = useMemo(() => ({ existing, open: setOpened }), []);
  return <>
    <FileTree links={links} code={"ui/src/ui/\n  + OptionRow.tsx # one choice: name, variant, details\n  ~ ModelPicker.tsx\n  - modelMenu.css\n~ ui/src/mentionSource.ts # now returns groups"} />
    <p>{opened ?? "Nothing opened"}</p>
  </>;
}
export function Unmarked() {
  return <FileTree code={"docs/\n  briefs/\n    reply-format.md\n  README.md"} />;
}
export function Layout() {
  return <FileTree code={"server/src/pace-tools/\n  reader.ts # Read-only interface required by tools\n  context.ts # Builds FinanceToolContext\n  catalog.ts # Schemas, descriptions, and tool handlers\n  queries/ # Structured finance operations\n  appCards.ts # Optional Pace app card presentation"} />;
}
export function DeepLayout() {
  return <FileTree code={"server/src/pace-tools/\n  reader.ts # Read-only interface required by tools\n  queries/ # Structured finance operations\n    balances.ts # Account balances at a date\n    earmarks/\n      earmarkReconciliationAgainstCheckingAndSavingsAccounts.ts # Matches earmarks to account balances and reports the shortfall\n      index.ts\n  catalog.ts # Schemas, descriptions, and tool handlers"} />;
}
