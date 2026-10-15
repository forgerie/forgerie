import { Check } from "typebox/value";
import { BacklogGitHubConfigSchema } from "@shared/backlog";
import type { BacklogProjectSettings } from "@shared/backlogSettings";
import type { BacklogSourceSettings } from "@shared/backlogSources";
export const backlogSettingsOrigin = (source: BacklogProjectSettings["source"]) => source === "forgerie" ? "Set in Forgerie" : source === "repo-file" ? "From the repo file" : "Default: Markdown";

/**
 * What Settings → Backlog has open: the list, one project, one source, or a new source. A project id is a UUID,
 * so `source:` cannot begin one, and a project link written before sources still opens that project.
 */
export type BacklogSettingsPlace = { kind: "list" } | { kind: "project"; projectId: string } | { kind: "source"; sourceId: string } | { kind: "new-source" };
const SOURCE = "source:";
const NEW_SOURCE = `${SOURCE}new`;
export function readBacklogSettingsPlace(selected: string | undefined): BacklogSettingsPlace {
  if (!selected) return { kind: "list" };
  if (selected === NEW_SOURCE) return { kind: "new-source" };
  return selected.startsWith(SOURCE) ? { kind: "source", sourceId: selected.slice(SOURCE.length) } : { kind: "project", projectId: selected };
}
export const sourceSelection = (sourceId: string | undefined) => sourceId === undefined ? NEW_SOURCE : `${SOURCE}${sourceId}`;

/** A source's board, as its row's second name: "amazeinsights", or "amazeinsights · Team\Web" with an Area Path. */
export const sourceBoard = (source: Pick<BacklogSourceSettings, "organization" | "areaPath">) => source.areaPath ? `${source.organization} · ${source.areaPath}` : source.organization;

/** Where a source's sessions start, in the list's words. A destination whose project left Forgerie is kept, and said. */
export function sourceDestinationText(source: Pick<BacklogSourceSettings, "destinationProjectId">, projects: readonly { id: string; name: string }[]): string {
  if (source.destinationProjectId === undefined) return "Not routed: each start asks for a project";
  const project = projects.find((entry) => entry.id === source.destinationProjectId);
  return project ? `→ ${project.name}` : "Not routed: its destination project is no longer registered";
}

const BOT_LOGIN = BacklogGitHubConfigSchema.properties.trustedBots.items;
/** The most bots one project lists, as the schema's maxItems says. The Add button turns off at this count. */
export const TRUSTED_BOT_LIMIT = 20;
/**
 * The trusted-bots draft, one row per entry as typed. A blank row is not an entry: it shows no problem and is not
 * sent. A filled row shows its problem: a login GitHub does not give a bot, or one already listed above it, in any
 * letter case, because GitHub logins ignore case.
 */
export function trustedBotProblems(rows: readonly string[]): (string | undefined)[] {
  const seen = new Map<string, string>();
  return rows.map((row) => {
    const login = row.trim();
    if (!login) return undefined;
    if (!Check(BOT_LOGIN, login)) return "Use the bot's GitHub login, which ends in [bot], such as coderabbitai[bot].";
    const first = seen.get(login.toLowerCase());
    if (first !== undefined) return `Already listed as ${first}.`;
    seen.set(login.toLowerCase(), login);
    return undefined;
  });
}
/** The entries a save sends: filled rows without a problem, at most the limit. With no problem in the draft, that is every filled row. */
export function trustedBotsToSend(rows: readonly string[]): string[] {
  const problems = trustedBotProblems(rows);
  return rows.map((row) => row.trim()).filter((login, index) => login && problems[index] === undefined).slice(0, TRUSTED_BOT_LIMIT);
}
