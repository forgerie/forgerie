// The GitHub App contract (src/shared/github.ts on Forgerie's main branch).
// Forgerie reads GitHub as its own app. The server keeps the app's key; every reply here is safe to show.
import { z } from "zod";
import type { Fetch } from "../newSession";

export const githubAppSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("not-configured") }),
  z.object({
    state: z.literal("configured"),
    app: z.object({ slug: z.string().min(1), owner: z.string().min(1), url: z.string().regex(/^https:\/\//u) }),
    installUrl: z.string().regex(/^https:\/\/github\.com\//u),
  }),
]);
export type GitHubAppState = z.infer<typeof githubAppSchema>;
/** The form that asks GitHub to create the app. Only github.com is ever a target. */
export const githubSetupSchema = z.object({ action: z.string().regex(/^https:\/\/github\.com\/settings\/apps\/new\?state=/u), manifest: z.string().min(2) });
export type GitHubSetup = z.infer<typeof githubSetupSchema>;

/** A server older than GitHub App setup answers 404; that reads as "not set up", not as a failure. */
export function createGitHubApi(fetchFn: Fetch) {
  async function call<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    const response = await fetchFn(path, init);
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = z.object({ error: z.string() }).safeParse(body);
      throw new Error(error.success ? error.data.error : `Request failed: HTTP ${String(response.status)}`);
    }
    return schema.parse(body);
  }
  const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return {
    status: async (signal?: AbortSignal): Promise<GitHubAppState> => {
      const response = await fetchFn("/api/github/app", signal ? { signal } : {});
      if (response.status === 404) return { state: "not-configured" };
      if (!response.ok) throw new Error(`Request failed: HTTP ${String(response.status)}`);
      return githubAppSchema.parse(await response.json());
    },
    /** `origin` is this page's own address: GitHub returns there after Create and after each install. */
    setup: (origin: string) => call("/api/github/app/setup", githubSetupSchema, post({ origin })),
    created: (code: string, state: string) => call("/api/github/app/created", githubAppSchema, post({ code, state })),
    remove: () => call("/api/github/app", githubAppSchema, { method: "DELETE" }),
  };
}
export type GitHubApi = ReturnType<typeof createGitHubApi>;

/** Posts the manifest to GitHub, as GitHub's manifest flow requires: a form, not a fetch. */
export function submitToGitHub(setup: GitHubSetup, doc: Document = document): void {
  const form = doc.createElement("form");
  form.method = "post";
  form.action = setup.action;
  const field = doc.createElement("input");
  field.type = "hidden";
  field.name = "manifest";
  field.value = setup.manifest;
  form.append(field);
  doc.body.append(form);
  form.submit();
}

/** GitHub's return after Create: `?code=…&state=forgerie-…`. Anything else is not ours. */
export function readSetupReturn(search: string): { code: string; state: string } | undefined {
  const params = new URLSearchParams(search);
  const code = params.get("code");
  const state = params.get("state");
  return code && state?.startsWith("forgerie-") ? { code, state } : undefined;
}
