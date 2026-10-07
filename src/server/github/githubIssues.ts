import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { apiHeaders, GITHUB_API, type Fetch, type GitHubApp } from "./githubApp.js";

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
export type GitHubIssue = Omit<Static<typeof IssueSchema>, "pull_request" | "labels"> & {
  labels: string[];
  /** The author can already change the repo: owner, member, or anyone with write access. */
  trusted: boolean;
};

/** GitHub's own words for people the repo already trusts. */
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
/** Write access or more: these authors could change the code directly, so their issue text is no new risk. */
const TRUSTED_PERMISSIONS = new Set(["admin", "maintain", "write"]);
/** How long an author's permission on a repo is believed. */
const PERMISSION_MS = 60 * 60_000;
/** At most this many authors are checked per read, so a busy public repo cannot spend the rate limit. */
const MAX_PERMISSION_CHECKS = 20;
const PermissionSchema = Type.Object({ permission: Type.String() });

export type IssuesResult =
  | { ok: true; issues: GitHubIssue[]; truncated: boolean; staleSince?: string; staleReason?: string }
  | { ok: false; kind: "auth" | "install" | "unavailable"; message: string };

interface Page { etag: string | undefined; issues: GitHubIssue[]; next: string | undefined }
interface Listing { pages: Page[]; truncated: boolean; fetchedAt: number }

export interface GitHubIssueClientDependencies {
  app: Pick<GitHubApp, "tokenFor" | "dropToken" | "installUrl">;
  fetch: Fetch;
  now?: () => number;
}

/**
 * Open issues of a GitHub repo, read as Forgerie's GitHub App. Caches each list, revalidates with ETags
 * (GitHub does not count a 304 against the rate limit), sends one request at a time as GitHub asks,
 * and stops asking while GitHub says it is rate limited.
 */
export class GitHubIssueClient {
  private readonly cache = new Map<string, Listing>();
  private readonly permissions = new Map<string, { trusted: boolean; checkedAt: number }>();
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
    const key = slug.toLowerCase();
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
    await this.checkAuthors(slug, listing, token);
    this.cache.set(key, listing);
    return listed(listing);
  }

  /**
   * GitHub hides private organization membership from an app, so a member's issue can arrive marked
   * `CONTRIBUTOR`. For those authors, ask GitHub what the author may do in the repo. A failed check
   * leaves the issue untrusted: hiding a trusted issue is recoverable, showing an untrusted one is not.
   */
  private async checkAuthors(slug: string, listing: Listing, token: string): Promise<void> {
    const issues = listing.pages.flatMap((page) => page.issues);
    const unknown = [...new Set(issues.filter((issue) => !issue.trusted && issue.author_association === "CONTRIBUTOR" && issue.user !== null)
      .map((issue) => issue.user?.login ?? ""))].filter(Boolean);
    let checks = 0;
    for (const login of unknown) {
      const key = `${slug.toLowerCase()}\n${login.toLowerCase()}`;
      const known = this.permissions.get(key);
      if (known !== undefined && this.now() - known.checkedAt < PERMISSION_MS) continue;
      if (++checks > MAX_PERMISSION_CHECKS) break;
      try {
        const response = await this.deps.fetch(`${GITHUB_API}/repos/${slug}/collaborators/${encodeURIComponent(login)}/permission`, { headers: apiHeaders(token) });
        const body: unknown = await response.json().catch(() => undefined);
        const trusted = response.ok && Check(PermissionSchema, body) && TRUSTED_PERMISSIONS.has(body.permission);
        if (response.ok || response.status === 404) this.permissions.set(key, { trusted, checkedAt: this.now() });
      } catch { /* Unreachable: the issue stays untrusted until the next read. */ }
    }
    for (const issue of issues) {
      if (issue.trusted || issue.user === null) continue;
      issue.trusted = this.permissions.get(`${slug.toLowerCase()}\n${issue.user.login.toLowerCase()}`)?.trusted === true;
    }
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
    author_association: value.author_association, user: value.user,
    labels: value.labels.map((label) => typeof label === "string" ? label : label.name),
    trusted: TRUSTED_ASSOCIATIONS.has(value.author_association),
  };
}
/** GitHub says to follow its `Link` header rather than build page URLs. */
function nextLink(header: string | null): string | undefined {
  const match = header?.split(",").map((part) => /<([^>]+)>\s*;\s*rel="next"/u.exec(part.trim())).find((candidate) => candidate !== null);
  const url = match?.[1];
  return url?.startsWith(`${GITHUB_API}/`) === true ? url : undefined;
}
function clock(ms: number): string { return new Date(ms).toISOString().slice(11, 16) + " UTC"; }
