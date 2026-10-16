import { RevisionList } from "./RevisionList";

export const name = "Revision list";
export const note = "Revisions with a hash that copies, a subject, and how far each got: local, pushed, landed or deployed";

export default function FourStates() {
  return <RevisionList code={"1d3c2ba7 landed fix(ui): mirror the gated action schema\n2d57cd45 pushed feat(ui): open files named in a reply's files block in the editor\n721dd29a deployed fix(chat): resolve relative links within the session workspace\nfa390d3 local contrib/android-base rebase (3 commits, was 4)"} />;
}
export function TwelveLong() {
  return <RevisionList code={"Branch against origin/main\n721dd29a deployed fix(chat): resolve relative links within the session workspace\n1d3c2ba7 landed fix(ui): mirror the gated action schema\n9e04b1c2 landed refactor(sessiond): move the reply format guide behind appendSystemPromptOverride so profiles that ship their own SYSTEM.md still get it, and drop the duplicate copy in the hosted-session bootstrap\n4b7f00ad landed test(ui): stream the follow-up in 6-character chunks\n2d57cd45 pushed feat(ui): open files named in a reply's files block in the editor\nc81a9e3f pushed fix(processes): keep a child's process after the child run when keepAfterChild is set\n0aa45d17 pushed docs: managed processes in plugins.md\n77b2de90 pushed chore(deps): bump streamdown to 1.6.4\nfa390d3 local contrib/android-base rebase (3 commits, was 4)\n3e9d1f20 local wip(ui): ledger block spike\nb2c7a611 local fix(ui): `useMarkdownLinkScope().origin`→`UNAVAILABLE_FILE_ORIGIN_FOR_WORKSPACES_WITHOUT_A_FILE_SERVER`\ne5f0c9aa local test: Fold 8 posture captures"} />;
}
