import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { apiHeaders, GITHUB_API, type Fetch, type GitHubApp } from "./githubApp.js";
import { GitHubAuthorTrust } from "./githubTrust.js";

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
  assignees: Type.Optional(Type.Array(Type.Object({ login: Type.String() }))),
  pull_request: Type.Optional(Type.Unknown()),
});
const PageSchema = Type.Array(Type.Unknown());
export type GitHubIssue = Omit<Static<typeof IssueSchema>, "pull_request" | "labels"> & {
  labels: string[];
  /** The author can already change the repo: owner, member, or anyone with write access. */
  trusted: boolean;
};


export type IssuesResult =
  | { ok: true; issues: GitHubIssue[]; truncated: boolean; staleSince?: string; staleReason?: string }
  | { ok: false; kind: "auth" | "install" | "unavailable"; message: string };

interface Page { etag: string | undefined; issues: GitHubIssue[]; next: string | undefined }
interface Listing { pages: Page[]; truncated: boolean; fetchedAt: number }

export interface GitHubIssueClientDependencies {
  app: Pick<GitHubApp, "tokenFor" | "dropToken" | "installUrl">;
  fetch: Fetch;
  now?: () => number;
  /** Shared with the agent tools, so both ask GitHub about an author once an hour. */
  trust?: GitHubAuthorTrust;
}

/**
 * Open issues of a GitHub repo, read as Forgerie's GitHub App. Caches each list, revalidates with ETags
 * (GitHub does not count a 304 against the rate limit), sends one request at a time as GitHub asks,
 * and stops asking while GitHub says it is rate limited.
 */
export class GitHubIssueClient {
  private readonly cache = new Map<string, Listing>();
  private readonly trust: GitHubAuthorTrust;
  private queue: Promise<unknown> = Promise.resolve();
  private blockedUntil = 0;
  private readonly now: () => number;
  constructor(private readonly deps: GitHubIssueClientDependencies) {
    this.now = deps.now ?? Date.now;
    this.trust = deps.trust ?? new GitHubAuthorTrust({ fetch: deps.fetch, now: this.now });
  }

  openIssues(slug: string, trustedBots: readonly string[] = []): Promise<IssuesResult> {
    const run = this.queue.then(() => this.read(slug, trustedBots), () => this.read(slug, trustedBots));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async read(slug: string, trustedBots: readonly string[]): Promise<IssuesResult> {
    // A cached trust decision must never cross project policies, even for the same repository.
    const key = JSON.stringify([slug.toLowerCase(), [...new Set(trustedBots.map(login => login.toLowerCase()))].sort()]);
    const cached = this.cache.get(key);
    if (cached !== undefined && this.now() - cached.fetchedAt < FRESH_MS) return listed(cached);
    if (this.now() < this.blockedUntil) return stale(cached, `GitHub rate limit reached; Forgerie asks again after ${clock(this.blockedUntil)}.`);
    let token: string;
    try {
      const granted = await this.deps.app.tokenFor(slug);
      // Without access there is no last good list worth showing: it may belong to a removed app.
      if (!granted.ok) { this.cache.delete(key); return granted; }
      token = granted.token;
    } catch (error) {
      return stale(cached, `GitHub is unreachable: ${error instanceof Error ? error.message : String(error)}`);
    }
    const pages: Page[] = [];
    let url: string | undefined = `${GITHUB_API}/repos/${slug}/issues?state=open&per_page=100`;
    let truncated = false;
    try {
      while (url !== undefined) {
        if (pages.length === MAX_PAGES) { truncated = true; break; }
        const previous = cached?.pages[pages.length];
        const response = await this.deps.fetch(url, { headers: { ...apiHeaders(token), ...(previous?.etag === undefined ? {} : { "If-None-Match": previous.etag }) } });
        if (response.status === 304 && previous !== undefined) { pages.push(previous); url = previous.next; continue; }
        if (!response.ok) return this.refused(response, slug, cached);
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
    await this.checkAuthors(slug, listing, token, trustedBots);
    this.cache.set(key, listing);
    return listed(listing);
  }

  /** Marks each issue trusted or not, so the backlog can hide outside contributions. */
  private async checkAuthors(slug: string, listing: Listing, token: string, trustedBots: readonly string[]): Promise<void> {
    const issues = listing.pages.flatMap((page) => page.issues);
    const authorOf = (issue: GitHubIssue) => ({ login: issue.user?.login, association: issue.author_association });
    const trusted = await this.trust.judge(slug, token, issues.map(authorOf), trustedBots);
    for (const issue of issues) issue.trusted = trusted(authorOf(issue));
  }

  private refused(response: Response, slug: string, cached: Listing | undefined): IssuesResult {
    if (response.status === 401) {
      // An installation token was revoked early. The next read mints a new one.
      this.deps.app.dropToken(slug);
      return stale(cached, "GitHub refused Forgerie's token; it asks again with a new one on the next read.");
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
      // The app is installed but cannot read issues here: the repo was left out of the installation's list.
      this.deps.app.dropToken(slug);
      const install = this.deps.app.installUrl();
      return { ok: false, kind: "install", message: `Forgerie's GitHub App cannot read issues on ${slug}. Add the repo to its installation${install === undefined ? "" : `: ${install}`}` };
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
    author_association: value.author_association, user: value.user, assignees: value.assignees ?? [],
    labels: value.labels.map((label) => typeof label === "string" ? label : label.name),
    trusted: false,
  };
}
/** GitHub says to follow its `Link` header rather than build page URLs. */
function nextLink(header: string | null): string | undefined {
  const match = header?.split(",").map((part) => /<([^>]+)>\s*;\s*rel="next"/u.exec(part.trim())).find((candidate) => candidate !== null);
  const url = match?.[1];
  return url?.startsWith(`${GITHUB_API}/`) === true ? url : undefined;
}
function clock(ms: number): string { return new Date(ms).toISOString().slice(11, 16) + " UTC"; }
