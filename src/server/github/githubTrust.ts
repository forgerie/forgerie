import { Type } from "typebox";
import { Check } from "typebox/value";
import { apiHeaders, GITHUB_API, type Fetch } from "./githubApp.js";

/** GitHub's own words for people the repo already trusts. */
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
/** Write access or more: these authors could change the code directly, so their text is no new risk. */
const TRUSTED_PERMISSIONS = new Set(["admin", "maintain", "write"]);
/** How long an author's permission on a repo is believed. */
const PERMISSION_MS = 60 * 60_000;
/** At most this many authors are checked per call, so a busy public repo cannot spend the rate limit. */
const MAX_PERMISSION_CHECKS = 20;
const PermissionSchema = Type.Object({ permission: Type.String() });

/** Who wrote a piece of text on GitHub, as GitHub reports it. */
export interface GitHubAuthor { login: string | undefined; association: string }

export interface GitHubAuthorTrustDependencies {
  fetch: Fetch;
  now?: () => number;
  /** The login of Forgerie's own GitHub App, read on each call so a new app is trusted without a restart. */
  ownLogin?: () => string | undefined;
}

/**
 * Decides whether text an author wrote on a repo may reach an agent. Owners, members, and collaborators
 * are trusted. GitHub hides private organization membership from an app, so a member can arrive marked
 * `CONTRIBUTOR` or `NONE`; for those, GitHub is asked what the author may do in the repo, and write access or more
 * counts. Forgerie's own app writes as `<slug>[bot]` and GitHub marks it `NONE`; it is trusted because a
 * person installed it and only Forgerie holds its key. Projects can also explicitly trust named bots. No one can sign up with a `[bot]` login. A failed check
 * leaves the author untrusted: hiding trusted text is recoverable, showing untrusted text is not.
 */
export class GitHubAuthorTrust {
  private readonly permissions = new Map<string, { trusted: boolean; checkedAt: number }>();
  private readonly now: () => number;
  constructor(private readonly deps: GitHubAuthorTrustDependencies) { this.now = deps.now ?? Date.now; }

  /** A predicate that answers for each of `authors`, after at most one lookup per unknown author. */
  async judge(slug: string, token: string, authors: readonly GitHubAuthor[], trustedBots: readonly string[] = []): Promise<(author: GitHubAuthor) => boolean> {
    const own = this.deps.ownLogin?.()?.toLowerCase();
    const bots = new Set(trustedBots.map(login => login.toLowerCase()));
    const isListedBot = (author: GitHubAuthor) => author.login !== undefined && author.login.toLowerCase().endsWith("[bot]") && bots.has(author.login.toLowerCase());
    const isOwn = (author: GitHubAuthor) => own !== undefined && author.login?.toLowerCase() === own;
    const unknown = [...new Set(authors.filter((author) => (author.association === "CONTRIBUTOR" || author.association === "NONE") && author.login !== undefined && !isOwn(author) && !isListedBot(author))
      .map((author) => author.login ?? ""))];
    let checks = 0;
    for (const login of unknown) {
      const key = this.key(slug, login);
      const known = this.permissions.get(key);
      if (known !== undefined && this.now() - known.checkedAt < PERMISSION_MS) continue;
      if (++checks > MAX_PERMISSION_CHECKS) break;
      try {
        const response = await this.deps.fetch(`${GITHUB_API}/repos/${slug}/collaborators/${encodeURIComponent(login)}/permission`, { headers: apiHeaders(token) });
        const body: unknown = await response.json().catch(() => undefined);
        const trusted = response.ok && Check(PermissionSchema, body) && TRUSTED_PERMISSIONS.has(body.permission);
        if (response.ok || response.status === 404) this.permissions.set(key, { trusted, checkedAt: this.now() });
      } catch { /* Unreachable: the author stays untrusted until the next call. */ }
    }
    return (author) => TRUSTED_ASSOCIATIONS.has(author.association) || isOwn(author) || isListedBot(author)
      || (author.login !== undefined && this.permissions.get(this.key(slug, author.login))?.trusted === true);
  }

  private key(slug: string, login: string): string { return `${slug.toLowerCase()}\n${login.toLowerCase()}`; }
}
