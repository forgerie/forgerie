import type { BacklogSuggestion, BacklogSuggestionState } from "../../../shared/backlogSuggestions.js";
import type { Project } from "../../../shared/apiTypes.js";
import type { SessionWorktrees } from "../../workspaces/sessionWorktrees.js";
import { parseBacklogItem } from "../backlogItem.js";
import { backlogGit, sweepBacklogScratch } from "./markdownScratch.js";
import { suggestionSource } from "./markdownWriter.js";

/** Git is the commit receipt. A unique frontmatter source proves ownership; path existence alone does not. */
export async function recoverMarkdownSuggestions(worktrees: Pick<SessionWorktrees, "options" | "withMainCheckout">, project: Project, records: readonly BacklogSuggestion[]): Promise<{ id: string; state: BacklogSuggestionState }[]> {
  const options = await worktrees.options(project.path);
  if (options.kind !== "git") {
    if (records.some(record => record.state.kind === "filing" && record.destination.provider === "markdown")) throw new Error("Cannot recover a Markdown filing until its Git project is available");
    return [];
  }
  return worktrees.withMainCheckout(options.repo, async () => {
    const recovered: { id: string; state: BacklogSuggestionState }[] = [];
    for (const record of records) {
      if (record.state.kind !== "filing" || record.destination.provider !== "markdown") continue;
      const path = record.destination.path;
      let ours = false;
      try {
        await backlogGit(options.repo, ["cat-file", "-e", `${options.defaultBranch}:${path}`]);
        const content = await backlogGit(options.repo, ["show", `${options.defaultBranch}:${path}`]);
        ours = parseBacklogItem(content).metadata.source === suggestionSource(record);
      } catch (error) {
        // Missing paths and invalid frontmatter cannot prove a successful fast-forward.
        if (!(error instanceof Error)) throw error;
        if ("code" in error && error.code !== 1 && error.code !== 128) throw error;
      }
      recovered.push({ id: record.id, state: ours ? { kind: "filed", provider: "markdown", path, at: new Date().toISOString(), ...(record.state.launchChoice === undefined ? {} : { launchChoice: record.state.launchChoice }) }
        : { kind: "failed", action: record.state.action, message: "Filing was interrupted before a verified fast-forward. No item from this suggestion exists on the default branch. Retry with a new requestId.", retryable: true } });
    }
    await sweepBacklogScratch(options.repo);
    return recovered;
  });
}
