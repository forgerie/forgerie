import { TriggerFileNotice } from "./TriggerFileNotice";

export const name = "Trigger file notice";
export const note = "One thing about a workflow file to see before its text: what saving does, an error, a gone file, a refusal";
export const composition = { default: [{ part: "src/ui/Consequence.molecule.part.tsx", state: "default" }] };

const none = () => undefined;
export default function Saving() {
  return <TriggerFileNotice notice={{ kind: "saving", before: "Saving writes the file. The next run, ", when: "Tue at 2:00 AM", after: ", reads it in all 3 projects. Launches by hand read it too." }} />;
}
export function Invalid() {
  return <TriggerFileNotice notice={{ kind: "invalid", line: 5, title: "Line 5 of the file has an error.", message: "`at` must be a time such as \"01:00\". The file now says \"1am\".",
    running: "Tonight's run uses the last good version, saved today at 9:41 AM: every night at 1:00 AM, 3 projects.", onShowLine: none, onPause: none }} />;
}
export function NoSchedule() {
  return <TriggerFileNotice notice={{ kind: "missing", title: "The file has no schedule now, so the trigger is paused.",
    text: "Change a setting in the side panel and save to write the schedule back, or add a schedule block in Source. Its 3 runs stay under Runs." }} />;
}
export function Refused() {
  return <TriggerFileNotice notice={{ kind: "refused", line: 5, message: "`at` must be a time such as \"01:00\". The file says \"2am\".", onShowLine: none }} />;
}
export function Panel() { return <TriggerFileNotice notice={{ kind: "panel" }} />; }
