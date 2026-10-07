// The GitHub login contract (src/shared/github.ts on Forgerie's main branch).
// The server keeps the tokens; every reply here is a state a person can read.
import { z } from "zod";
import type { Fetch } from "../newSession";

const app = z.object({ clientId: z.string(), slug: z.string().optional().catch(undefined) });
export const githubAuthSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("not-configured") }),
  z.object({ state: z.literal("disconnected"), app, reason: z.string().optional().catch(undefined) }),
  z.object({ state: z.literal("pending"), app, userCode: z.string().min(1), verificationUri: z.string().regex(/^https:\/\//u), expiresAt: z.string() }),
  z.object({ state: z.literal("connected"), app, login: z.string().min(1), loginExpiresAt: z.string().optional().catch(undefined) }),
]);
export type GitHubAuthState = z.infer<typeof githubAuthSchema>;

/** A server older than GitHub login answers 404 here; that reads as "not set up", not as a failure. */
export function createGitHubApi(fetchFn: Fetch) {
  async function call(path: string, init: RequestInit = {}): Promise<GitHubAuthState> {
    const response = await fetchFn(path, init);
    if (response.status === 404) return { state: "not-configured" };
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = z.object({ error: z.string() }).safeParse(body);
      throw new Error(error.success ? error.data.error : `Request failed: HTTP ${String(response.status)}`);
    }
    return githubAuthSchema.parse(body);
  }
  return {
    status: (signal?: AbortSignal) => call("/api/github/auth", signal ? { signal } : {}),
    /** Starts a device login. The reply carries the code to enter at GitHub. */
    login: () => call("/api/github/auth/login", { method: "POST" }),
    disconnect: () => call("/api/github/auth", { method: "DELETE" }),
  };
}
export type GitHubApi = ReturnType<typeof createGitHubApi>;
