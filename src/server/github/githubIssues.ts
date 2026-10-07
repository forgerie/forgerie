import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { apiHeaders, GITHUB_API, type Fetch, type GitHubAuth } from "./githubAuth.js";

/** Matches GitHub's polling advice: reuse a list for a minute, then ask again with its ETag. */
const FRESH_MS = 60_000;
/** 500 open issues. A repo with more gets a scan-limit warning instead of an unbounded crawl. */
const MAX_PAGES = 5;

const IssueSchema = Type.Object({
  number: Type.Integer({ minimum: 1 }),
  title: Type.String(),
  body: Type.Union([Type.String(), Type.Null()]),
  html_url: Type.String({ pattern: "^https://" }),
  created_at: Type.String(),
  author_association: Type.String(),
  user: Type.Union([Type.Object({ login: Type.String() }), Type.Null()]),
  labels: Type.Array(Type.Union([Type.String(), Type.Object({ name: Type.String() })])),
  pull_request: Type.Optional(Type.Unknown()),
});
const PageSchema = Type.Array(Type.Unknown());
export type GitHubIssue = Omit<Static<typeof IssueSchema>, "pull_request" | "labels"> & { labels: string[] };

export type IssuesResult =
  | { ok: true; issues: GitHubIssue[]; truncated: boolean; staleSince?: string; staleReason?: string }
  | { ok: false; kind: "auth" | "unavailable"; message: string };

interface Page { etag: string | undefined; issues: GitHubIssue[]; next: string | undefined }
interface Listing { pages: Page[]; truncated: boolean; fetchedAt: number }

export interface GitHubIssueClientDependencies {
  auth: Pick<GitHubAuth, "accessToken" | "loginName" | "rejectToken">;
  fetch: Fetch;
  now?: () => number;
  /** For the install link in access errors: `https://github.com/apps/<slug>/installations/new`. */
  appSlug?: () => string | undefined;
}

/**
 * Open issues of a GitHub repo, read as the logged-in user. Caches each list per login, revalidates with
 * ETags (GitHub does not count a 304 against the rate limit), sends one request at a time as GitHub asks,
 * and stops asking while GitHub says it is rate limited.
 */
export class GitHubIssueClient {
  private readonly cache = new Map<string, Listing>();
  private queue: Promise<unknown> = Promise.resolve();
  private blockedUntil = 0;
  private readonly now: () => number;
  constructor(private readonly deps: GitHubIssueClientDependencies) { this.now = deps.now ?? Date.now; }

  openIssues(slug: string): Promise<IssuesResult> {
    const run = this.queue.then(() => this.read(slug), () => this.read(slug));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async read(slug: string): Promise<IssuesResult> {
    const token = await this.deps.auth.accessToken();
    if (token === undefined) return { ok: false, kind: "auth", message: `Connect GitHub to list issues for ${slug}.` };
    const key = `${this.deps.auth.loginName() ?? ""}\n${slug.toLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached !== undefined && this.now() - cached.fetchedAt < FRESH_MS) return listed(cached);
    if (this.now() < this.blockedUntil) return stale(cached, `GitHub rate limit reached; Forgerie asks again after ${clock(this.blockedUntil)}.`);
    const pages: Page[] = [];
    let url: string | undefined = `${GITHUB_API}/repos/${slug}/issues?state=open&per_page=100`;
    let truncated = false;
    try {
      while (url !== undefined) {
        if (pages.length === MAX_PAGES) { truncated = true; break; }
        const previous = cached?.pages[pages.length];
        const response = await this.deps.fetch(url, { headers: { ...apiHeaders(token), ...(previous?.etag === undefined ? {} : { "If-None-Match": previous.etag }) } });
        if (response.status === 304 && previous !== undefined) { pages.push(previous); url = previous.next; continue; }
        if (!response.ok) return await this.refused(response, token, slug, cached);
        const body: unknown = await response.json();
        if (!Check(PageSchema, body)) throw new Error("GitHub sent an unexpected issue list");
        const issues = body.flatMap((value) => Check(IssueSchema, value) && value.pull_request === undefined ? [toIssue(value)] : []);
        const next = nextLink(response.headers.get("link"));
        pages.push({ etag: response.headers.get("etag") ?? undefined, issues, next });
        url = next;
      }
    } catch (error) {
      return stale(cached, `GitHub is unreachable: ${error instanceof Error ? error.message : String(error)}`);
    }
    const listing: Listing = { pages, truncated, fetchedAt: this.now() };
    this.cache.set(key, listing);
    return listed(listing);
  }

  private async refused(response: Response, token: string, slug: string, cached: Listing | undefined): Promise<IssuesResult> {
    if (response.status === 401) {
      await this.deps.auth.rejectToken(token);
      return { ok: false, kind: "auth", message: "GitHub no longer accepts Forgerie's login. Connect GitHub again." };
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    if (response.status === 429 || (response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || Number.isFinite(retryAfter) && retryAfter > 0))) {
      // GitHub may ban an integration that keeps asking while limited, so wait as long as it says, or a minute.
      this.blockedUntil = retryAfter > 0 ? this.now() + retryAfter * 1000 : reset > 0 ? reset * 1000 : this.now() + 60_000;
      return stale(cached, `GitHub rate limit reached; Forgerie asks again after ${clock(this.blockedUntil)}.`);
    }
    if (response.status === 410) return { ok: false, kind: "unavailable", message: `Issues are turned off on ${slug}.` };
    if (response.status === 403 || response.status === 404) {
      const slugOfApp = this.deps.appSlug?.();
      const install = slugOfApp === undefined ? "Install the Forgerie GitHub App on it" : `Install the Forgerie GitHub App on it: https://github.com/apps/${slugOfApp}/installations/new`;
      return { ok: false, kind: "unavailable", message: `Forgerie cannot read issues on ${slug}. ${install}. If the repo name is wrong, set backlog.github.repo in .forgerie/config.json.` };
    }
    return stale(cached, `GitHub answered HTTP ${String(response.status)}.`);
  }
}

function listed(listing: Listing): Extract<IssuesResult, { ok: true }> {
  return { ok: true, issues: listing.pages.flatMap((page) => page.issues), truncated: listing.truncated };
}
/** On a transient failure, keep showing the last good list and say how old it is. */
function stale(cached: Listing | undefined, reason: string): IssuesResult {
  if (cached === undefined) return { ok: false, kind: "unavailable", message: reason };
  return { ...listed(cached), staleSince: new Date(cached.fetchedAt).toISOString(), staleReason: reason };
}
function toIssue(value: Static<typeof IssueSchema>): GitHubIssue {
  return {
    number: value.number, title: value.title, body: value.body, html_url: value.html_url, created_at: value.created_at,
    author_association: value.author_association, user: value.user,
    labels: value.labels.map((label) => typeof label === "string" ? label : label.name),
  };
}
/** GitHub says to follow its `Link` header rather than build page URLs. */
function nextLink(header: string | null): string | undefined {
  const match = header?.split(",").map((part) => /<([^>]+)>\s*;\s*rel="next"/u.exec(part.trim())).find((candidate) => candidate !== null);
  const url = match?.[1];
  return url?.startsWith(`${GITHUB_API}/`) === true ? url : undefined;
}
function clock(ms: number): string { return new Date(ms).toISOString().slice(11, 16) + " UTC"; }
