import type { StateChecks } from "@simonwjackson/caliper/checks";
import { threadScenario } from "../ui/Thread.organism.part";
import type { RecapData } from "@shared/sessionRecap";
import type { TranscriptMessage } from "../transcript";
import { RecapEntry } from "./RecapEntry";
import { RecapRequest } from "./RecapRequest";
import type { RecapArtifact, RecapRequestState } from "./recapModel";

export const name = "While you were away";
export const note = "Saved session recaps and the transient writing/error line, in the production transcript and reply-text gutter";
const data: RecapData = {
  summary: "Finding what Grok Bot can do that the core assistant cannot. The gap table is done, and the browser gap is a PATH problem, not a missing skill. Next is choosing between the PATH fix and the notes correction.",
  trigger: "automatic", model: "anthropic/claude-haiku-5-5", messageCount: 8, coversThroughEntryId: "8",
  runEndedAt: "2026-10-22T15:52:15.000Z", generatedAt: "2026-10-22T16:02:15.000Z",
};
function Scenario({ recap = data, needs = "", request = { kind: "idle" } }: { recap?: RecapData; needs?: string; request?: RecapRequestState }) {
  const messages: TranscriptMessage[] = [
    { id: "user", role: "user", parts: [{ type: "text", text: "Which gaps are worth closing?" }] },
    { id: "answer", role: "assistant", parts: [{ type: "text", text: "The research is complete. The browser PATH fix and the correction to the notes remain. Nothing is deployed yet." }] },
    ...(request.kind === "idle" ? [{ id: "recap", role: "system" as const, parts: [], recap }] : []),
  ];
  return threadScenario({ title: "Session", first: messages,
    systemArtifact: custom => {
      const saved = (custom as Partial<RecapArtifact> | undefined)?.recap;
      return saved ? <RecapEntry data={saved} needs={needs} /> : undefined;
    }, tail: <RecapRequest state={request} /> });
}
export default function Ideal() { return <Scenario />; }
export function NeedsYou() { return <Scenario needs="Approve git push origin main for the flake.nix PATH fix. The fix is committed and tests pass." />; }
export function Loading() { return <Scenario request={{ kind: "writing" }} />; }
export function Failed() { return <Scenario request={{ kind: "failed", message: "Could not write a recap. Try /recap again." }} />; }
export function LongText() { return <Scenario recap={{ ...data, summary: `Fixed /home/${"longunbrokenpath".repeat(12)} and verified a first call. Deployment and the remaining validation are still open.` }} />; }
export function Legacy() { return <Scenario recap={{ goal: "Review the plan", done: ["Read it"], left: ["Comment"], next: "Send the comments", trigger: "manual", model: data.model,
  messageCount: 4, coversThroughEntryId: "4", runEndedAt: data.runEndedAt, generatedAt: data.generatedAt }} />; }

export const checks = {
  NeedsYou: {
    "the recap header and live obligation remain reachable above the tail": async ({ canvas, expect }) => {
      const panel = canvas.getByRole("region", { name: "While you were away" });
      panel.scrollIntoView({ block: "start", behavior: "instant" });
      expect(canvas.getByText("Needs you")).toBeVisible();
      expect(canvas.getByText("Approve git push origin main for the flake.nix PATH fix. The fix is committed and tests pass.")).toBeVisible();
    },
  },
} satisfies StateChecks;
