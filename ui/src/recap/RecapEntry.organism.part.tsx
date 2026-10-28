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
  goal: "Find what Grok Bot can do that the core assistant cannot, and which gaps are worth closing",
  done: ["Gap table from three researchers and one scout", "Corrected the browser finding: the assistant does browse, through the agent-browser skill, but the first call always fails because it is not on the service PATH"],
  left: ["Add agent-browser and chromium to assistantToolPath in flake.nix", "Add the correction to ~/.cache/research/grokbot-vs-assistant-20261022T155215/"],
  next: "Choose which of the two to do first. Browser takeover and saved logins stay open as the real gaps.",
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
export function LongText() { return <Scenario recap={{ ...data, done: Array(4).fill("Implemented the browser fix and verified a first call. Deployment remains incomplete."),
  left: [`/home/${"longunbrokenpath".repeat(12)}`, ...Array(3).fill("Run the remaining validation before deployment; this caveat stays in the recap.")] }} />; }
export function GoalOnly() { return <Scenario recap={{ ...data, goal: "Review the plan", done: [], left: [], next: null, trigger: "manual" }} />; }

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
