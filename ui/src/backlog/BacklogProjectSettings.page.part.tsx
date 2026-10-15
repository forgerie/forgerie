import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import type { BacklogProjectSettings as ProjectSettingsEntry } from "@shared/backlogSettings";
import { BacklogProjectSettings } from "./BacklogProjectSettings";
import { trustedBotProblems } from "./backlogSettingsModel";
import { retiredAzureProject, trustedBotsProject } from "./fixtures/backlogSources";

export const name = "BacklogProjectSettings";
export const note = "One project's backlog: Markdown and GitHub, and the bots GitHub trusts. A repo file's Azure DevOps section is retired, and says so";
export const checks = {
  TrustedBotInvalid: {
    "a bot login without [bot] holds Save and says why": async ({ canvas, expect }) => {
      expect(canvas.getByRole("button", { name: "Save changes" })).toBeDisabled();
      expect(canvas.getByText("Use the bot's GitHub login, which ends in [bot], such as coderabbitai[bot].")).toBeVisible();
    },
    "Save runs only once both bad rows are removed": async ({ canvas, input, expect }) => {
      await input.click(canvas.getByRole("button", { name: "Remove coderabbit" }));
      expect(canvas.getByText("Already listed as coderabbitai[bot].")).toBeVisible();
      expect(canvas.getByRole("button", { name: "Save changes" })).toBeDisabled();
      await input.click(canvas.getByRole("button", { name: "Remove CodeRabbitAI[bot]" }));
      expect(canvas.getByRole("button", { name: "Save changes" })).toBeEnabled();
    },
  },
  TrustedBotsEmpty: {
    "turning trusted-only off hides the bots": async ({ canvas, input, expect }) => {
      expect(canvas.getByText("No bots listed. Their comments reach the agent as hidden text.")).toBeVisible();
      await input.click(canvas.getByRole("switch", { name: "Trusted authors only" }));
      expect(canvas.queryByText("Trusted bots")).toBeNull();
    },
  },
} satisfies StateChecks;

function Stateful({ entry, rows }: { entry: ProjectSettingsEntry; rows?: string[] }) {
  const [providers, setProviders] = useState<string[]>(entry.backlog.providers ?? ["markdown"]);
  const [repo, setRepo] = useState("");
  const [trusted, setTrusted] = useState(true);
  const [bots, setBots] = useState<string[]>(rows ?? entry.backlog.github?.trustedBots ?? []);
  const problems = trustedBotProblems(bots);
  return <BacklogProjectSettings entry={entry} name="design-system" back={null} close={null} busy={false} error={undefined}
    valid={providers.length > 0 && !(providers.includes("github") && trusted && problems.some(Boolean))}
    providers={providers} onSources={setProviders} repo={repo} onRepo={setRepo} trusted={trusted} onTrusted={setTrusted}
    bots={bots} botProblems={problems} onBots={setBots}
    onSave={() => undefined} onRemove={() => undefined} onReload={() => undefined} />;
}
export default function Ready() { return <Stateful entry={{ projectId: "p", source: "default", backlog: { providers: ["markdown"] } }} />; }
export function RetiredAzure() { return <Stateful entry={retiredAzureProject} />; }
/** GitHub on, trusted authors only, and no bots listed yet. */
export function TrustedBotsEmpty() { return <Stateful entry={{ ...trustedBotsProject, backlog: { providers: ["markdown", "github"], github: { authors: "trusted" } } }} />; }
/** Three review bots whose comments reach the agent. */
export function TrustedBots() { return <Stateful entry={trustedBotsProject} />; }
/** A login typed without its [bot] suffix, and a second listing of a bot in other letter case: Save waits. */
export function TrustedBotInvalid() { return <Stateful entry={trustedBotsProject} rows={["coderabbitai[bot]", "coderabbit", "CodeRabbitAI[bot]"]} />; }
