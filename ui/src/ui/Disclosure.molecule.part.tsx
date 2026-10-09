import { Disclosure } from "./Disclosure";

export const name = "Disclosure";
export const note = "Supporting material behind a one-line summary, closed by default";

export default function Closed() {
  return <Disclosure code={"All 14 options the migration accepts\n- `--to <n>` sets the target version.\n- `--dry-run` prints the plan and writes nothing.\n- `--backup <dir>` keeps a copy before writing."} />;
}
export function SummaryOnly() {
  return <Disclosure code={"Why the first attempt failed"} />;
}
