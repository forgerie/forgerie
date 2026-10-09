import { ProcessEventView } from "./ProcessEventView";
import { parseProcessEvent } from "./processEvent";
import { failedLog, failedLongLog, failedLongXml, failedXml, fixtureTime, matchedXml, stoppedXml, succeededXml } from "./fixtures/processEvents";

export const name = "Process event";
export const note = "A managed process finished, failed, stopped, or printed a watched line";

export default function Failed() {
  return <ProcessEventView event={parseProcessEvent(failedXml, fixtureTime)!} onLoadOutput={async () => failedLog} />;
}
export function Succeeded() {
  return <ProcessEventView event={parseProcessEvent(succeededXml, fixtureTime)!} />;
}
export function Matched() {
  return <ProcessEventView event={{ ...parseProcessEvent(matchedXml, fixtureTime)!, repeats: 3 }} />;
}
export function Stopped() {
  return <ProcessEventView event={parseProcessEvent(stoppedXml, fixtureTime)!} />;
}
export function FailedOffline() {
  return <ProcessEventView event={parseProcessEvent(failedXml, fixtureTime)!} />;
}
export function FailedLongCommand() {
  return <ProcessEventView event={parseProcessEvent(failedLongXml, fixtureTime)!} onLoadOutput={async () => failedLongLog} />;
}
