import { Checklist } from "./Checklist";

export const name = "Checklist";
export const note = "A status snapshot of tasks: done, in progress, not started, failed, skipped";

export default function Mixed() {
  return <Checklist code={"Release checks\n[x] Type check\n[x] Unit tests: 1017 passed\n[~] Visual review\n[!] Folded portrait capture\n    The composer covers the last option row.\n[ ] Deploy\n[-] Tablet check"} />;
}
export function AllDone() {
  return <Checklist code={"[x] Build\n[x] Lint\n[x] Tests"} />;
}
export function LongText() {
  return <Checklist code={"[!] `npm run verify` failed in `src/server/sessions/globalProviderPolicy.acceptance.test.ts` after 5000 ms under full-suite load\n    It passes alone and on `main`.\n[x] A second item"} />;
}
