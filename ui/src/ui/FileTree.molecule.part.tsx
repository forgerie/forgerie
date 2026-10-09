import { FileTree } from "./FileTree";

export const name = "File tree";
export const note = "Files a change touched, marked added, changed or deleted";

export default function Change() {
  return <FileTree code={"src/server/sessions/\n  ~ piSessionService.ts # injects the guide\n  + replyFormatGuide.acceptance.test.ts\nui/src/ui/\n  + Checklist.tsx\n  + Checklist.css\n  ~ theme.css # adds block tokens\n- src/server/sessions/replyFormatGuide.ts # moved to src/shared"} />;
}
export function FlatPaths() {
  return <FileTree code={"+ ui/src/ui/Diagram.tsx\n+ ui/src/ui/Diagram.css\n~ ui/package.json"} />;
}
export function Unmarked() {
  return <FileTree code={"docs/\n  briefs/\n    reply-format.md\n  README.md"} />;
}
