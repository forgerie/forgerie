import { z } from "zod";

/**
 * A deployed build names its entry script in `build.json`, beside
 * `index.html`. The script's file name carries a hash of the whole module
 * graph, so it changes exactly when the app's code changes, and a rebuild of
 * the same code does not ask anyone to refresh.
 */
export const BUILD_FILE = "build.json";
const buildSchema = z.object({ entry: z.string().min(1) });

/** The entry script's file name, from the entry module's own URL. */
export function entryName(moduleUrl: string): string {
  return new URL(moduleUrl).pathname.split("/").pop() ?? "";
}

export type UpdateCheck =
  | { type: "current" }
  | { type: "available"; entry: string }
  /** No answer, or one this client cannot read: say nothing. */
  | { type: "unknown" };

export function checkBuild(running: string, published: unknown): UpdateCheck {
  const parsed = buildSchema.safeParse(published);
  if (!parsed.success) return { type: "unknown" };
  return parsed.data.entry === running ? { type: "current" } : { type: "available", entry: parsed.data.entry };
}

/** Reads the deployed build past every cache. A network failure is `unknown`, not an error. */
export async function fetchBuild(running: string, fetchFn: typeof fetch = fetch, base = document.baseURI): Promise<UpdateCheck> {
  try {
    const response = await fetchFn(new URL(BUILD_FILE, base), { cache: "no-store" });
    if (!response.ok) return { type: "unknown" };
    return checkBuild(running, await response.json());
  } catch {
    return { type: "unknown" };
  }
}
