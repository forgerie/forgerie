import { useState } from "react";
import type { BacklogProjectSettings as ProjectSettingsEntry } from "@shared/backlogSettings";
import { BacklogProjectSettings } from "./BacklogProjectSettings";
import { retiredAzureProject } from "./fixtures/backlogSources";

export const name = "BacklogProjectSettings";
export const note = "One project's backlog: Markdown and GitHub. A repo file's Azure DevOps section is retired, and says so";

function Stateful({ entry }: { entry: ProjectSettingsEntry }) {
  const [providers, setProviders] = useState<string[]>(entry.backlog.providers ?? ["markdown"]);
  const [repo, setRepo] = useState("");
  const [trusted, setTrusted] = useState(true);
  return <BacklogProjectSettings entry={entry} name="design-system" back={null} close={null} busy={false} error={undefined} valid={providers.length > 0}
    providers={providers} onSources={setProviders} repo={repo} onRepo={setRepo} trusted={trusted} onTrusted={setTrusted}
    onSave={() => undefined} onRemove={() => undefined} onReload={() => undefined} />;
}
export default function Ready() { return <Stateful entry={{ projectId: "p", source: "default", backlog: { providers: ["markdown"] } }} />; }
export function RetiredAzure() { return <Stateful entry={retiredAzureProject} />; }
