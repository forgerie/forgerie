/** Network-free data edge for the current PR sheet and its Actions parts. */
import type { OpenPullsResponse, PullPreviewResponse } from "../../pullRequests/pullRequestApi";
import type { PullDiscovery } from "../../pullRequests/useSessionPull";
import { pullItem } from "./pull";

const pull = pullItem.pull!;
const discoveryPulls: PullPreviewResponse[] = [
  { provider: "github", pull: { ...pull, number: 151, url: `https://github.com/${pull.repo}/pull/151`, title: "Keep preview reads separate from links", head: "fix/pr-preview" } },
  { provider: "github", pull: { ...pull, number: 152, url: `https://github.com/${pull.repo}/pull/152`, title: "Stream annotations for a long workflow name with no spaces", state: "draft", head: "spike/annotations" } },
];
const summary = (data: PullPreviewResponse) => ({ ...data.pull, state: data.pull.state === "draft" ? "draft" as const : "open" as const });
const discoveryOpen: OpenPullsResponse = { provider: "github", repo: pull.repo, complete: true, items: discoveryPulls.map(summary) };
export function pullDiscovery(scenario: "ready" | "empty" | "loading" | "error" | "many" = "ready"): PullDiscovery {
  return {
    open: async () => {
      if (scenario === "loading") return new Promise<OpenPullsResponse>(() => {});
      if (scenario === "error") throw new Error("Forgerie's GitHub App cannot read this repository. Check its repository access, then read open PRs again.");
      return scenario === "empty" ? { ...discoveryOpen, items: [] }
        : scenario === "many" ? { ...discoveryOpen, complete: false, items: Array.from({ length: 50 }, (_, index) => ({ ...summary(discoveryPulls[index % 2]!), number: index + 151, url: `https://github.com/${pull.repo}/pull/${String(index + 151)}` })) } : discoveryOpen;
    },
    preview: async number => {
      const data = discoveryPulls.find(data => data.pull.number === number);
      if (data) return data;
      if (number >= 151 && number <= 200 && scenario === "many") return { provider: "github", pull: { ...pull, number, url: `https://github.com/${pull.repo}/pull/${String(number)}`, title: `Repository pull request ${String(number)}` } };
      throw new Error(`This fixture has no pull request #${String(number)}. Choose #151 or #152.`);
    },
  };
}
