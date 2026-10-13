import { CommandBlock } from "./CommandBlock";

export const name = "Command block";
export const note = "One exact command or its output, shown whole: long lines wrap under a hanging indent, long output is cut with a toggle";

const LONG = "git -C /home/simon/code/forgerie/.worktrees/run-export stash list && git -C /home/simon/code/forgerie/.worktrees/run-export reset --hard origin/main && git -C /home/simon/code/forgerie/.worktrees/run-export clean -fdx";
const OUTPUT = [
  "Enumerating objects: 23, done.",
  "Counting objects: 100% (23/23), done.",
  "Delta compression using up to 16 threads",
  "Compressing objects: 100% (12/12), done.",
  "Writing objects: 100% (13/13), 4.18 KiB | 4.18 MiB/s, done.",
  "To github.com:simonwjackson/forgerie.git",
  " + 3f9c2e1...8a7b6d4 feat/run-export -> feat/run-export (forced update)",
].join("\n");

export default function Shell() {
  return <CommandBlock code="git push --force-with-lease origin feat/run-export" label="Command" copyLabel="Copy command" shell />;
}
export function LongCommand() {
  return <CommandBlock code={LONG} label="Command" copyLabel="Copy command" shell />;
}
export function CutOutput() {
  return <CommandBlock code={OUTPUT} label="Result" copyLabel="Copy result" lines={3} moreLabel="Show full result" />;
}
