import type { SearchHit } from "../searchApi";

/** The fixed clock of every search part. */
export const NOW = Date.UTC(2026, 9, 11, 15, 0);
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();
const marked = (text: string, word: string): [number, number][] => {
  const found: [number, number][] = [];
  const lower = text.toLowerCase();
  for (let at = lower.indexOf(word); at >= 0; at = lower.indexOf(word, at + word.length)) found.push([at, at + word.length]);
  return found;
};
function hit(sessionId: string, title: string, cwd: string, hours: number, role: "user" | "assistant", text: string, word: string,
  extra: Partial<Pick<SearchHit, "archived" | "offBranch" | "otherMatches">> = {}): SearchHit {
  return { sessionId, cwd, title, modified: ago(hours), archived: extra.archived ?? false, offBranch: extra.offBranch ?? false,
    otherMatches: extra.otherMatches ?? 0,
    passage: { entryId: `${sessionId}-entry`, role, timestamp: ago(hours), text, marks: marked(text, word) } };
}

export const QUERY = "deploy";
export const HITS: readonly SearchHit[] = [
  hit("s-deploy", "Fix the deploy script on zao", "/code/forgerie", 2, "user",
    "The deploy step fails when the Nix store is cold. Can you make deploy retry once before it gives up?", "deploy", { otherMatches: 6 }),
  hit("s-units", "Restart the systemd user units after a merge", "/code/forgerie/.worktrees/units", 26, "assistant",
    "I restarted forgerie-web.service and forgerie-sessiond.service. The deploy now tracks main without a rebuild.", "deploy", { otherMatches: 1 }),
  hit("s-branch", "Try two ways to cache the store", "/code/forgerie", 74, "assistant",
    "On this branch the deploy keeps a warm copy of the store path, so a cold start costs one fetch.", "deploy", { offBranch: true }),
  hit("s-old", "Ship 0.4 to the server", "/code/kori", 900, "user",
    "Write the deploy notes for 0.4 and list what changed in the session daemon.", "deploy", { archived: true, otherMatches: 2 }),
  hit("s-untitled", "", "/code/kori", 1200, "assistant",
    "A blue-green deploy needs two ports, and the proxy has to switch between them.", "deploy"),
];
export const MORE_HITS: readonly SearchHit[] = [
  hit("s-more-1", "Pin the Node version in the deploy", "/code/forgerie", 1500, "user", "Pin Node 24 in the deploy so the build is the same everywhere.", "deploy"),
  hit("s-more-2", "Read the deploy logs", "/code/kori", 1700, "assistant", "The deploy logs show the unit restarted twice.", "deploy"),
];
export const where = (cwd: string) => cwd.includes(".worktrees/") ? `forgerie · ${cwd.split("/").at(-1) ?? ""}` : cwd.split("/").at(-1) ?? cwd;
