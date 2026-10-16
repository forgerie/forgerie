import { CheckResults } from "./CheckResults";

export const name = "Check results";
export const note = "What a run of checks found: passed, failed or skipped, with results, and what was not checked";

export default function OneFailure() {
  return <CheckResults code={"Verification\npass: Full server suite — 2,900 passed, 5 skipped\nfail: Browser typecheck/build — 27 errors\npass: Typecheck, lint, Knip\npass: Restart proof\npass: `git diff --check cdb22b2c..8f33333d`\nskip: Physical Fold 8 — no device attached\nunchecked: Screen readers\nunchecked: A real 03:00 trigger fire"} />;
}
export function ManyWithLongToken() {
  return <CheckResults code={"Release checks for 0.42.0\npass: Full server suite — 2,900 passed, 5 skipped\npass: UI suite — 2,591 passed\npass: Typecheck — 0 errors\npass: ESLint — 0 problems\npass: Knip — 0 unused exports\npass: Gates — 36 of 36\npass: prove-bite.mjs — 36 of 36 bite\nfail: `APP_URL=http://127.0.0.1:8531/./scripts/rich-blocks-acceptance.mjs--posture=fold8-folded-portrait--scheme=dark--stream-chunk=6` — page overflows by 38 px\npass: Streamdown acceptance\npass: Restart proof — sessiond came back in 2.4 s\npass: Systemd unit reload\npass: `git diff --check cdb22b2c..8f33333d`\nskip: Physical Fold 8 — no device attached\nskip: Windows build — no runner\npass: Changeset present\npass: Licence scan — 0 new licences\nunchecked: Screen readers\nunchecked: A real 03:00 trigger fire\nunchecked: Upgrade from 0.39 with a live session"} />;
}
export function AllPassed() {
  return <CheckResults code={"pass: Build\npass: Lint\npass: Tests — 1017 passed"} />;
}
