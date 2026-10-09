import { BarChart } from "./BarChart";

export const name = "Bar chart";
export const note = "A few numbers of one kind on one scale";

export default function Durations() {
  return <BarChart code={"Slowest UI test files, seconds\nbuildContents.test.ts: 28.7 s\nApp.archiveNext.test.tsx: 7.2 s\nThread.test.tsx: 3.3 s\nsessionStore.dialog.test.ts: 0.9 s"} />;
}
export function WithZero() {
  return <BarChart code={"Failures by gate\nlayers: 0\nauthoring: 2\ndecomposition: 5"} />;
}
export function LongLabels() {
  return <BarChart code={"src/server/sessions/globalProviderPolicy.acceptance.test.ts: 6104 ms\nsrc/server/sessions/piSessionService.codemode.acceptance.test.ts: 7193 ms"} />;
}
