import { createSign, randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { Type } from "typebox";
import { Check } from "typebox/value";
import type { GitHubAppStatus, GitHubCreatedRequest, GitHubSetupStart } from "../../shared/github.js";
import type { GitHubAppStore, StoredGitHubApp } from "./githubAppStore.js";

export const GITHUB_WEB = "https://github.com";
export const GITHUB_API = "https://api.github.com";
export const GITHUB_API_VERSION = "2026-03-10";
/** GitHub's limit for finishing a manifest setup. */
const SETUP_WINDOW_MS = 60 * 60_000;
/** Installation tokens live 1 hour; renew this long before, so a scan never starts with a dying token. */
const TOKEN_MARGIN_MS = 5 * 60_000;
/** How long "not installed on this repo" is believed before GitHub is asked again. */
const MISSING_INSTALL_MS = 60_000;

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
export interface GitHubAppDependencies {
  store: GitHubAppStore;
  fetch: Fetch;
  now?: () => number;
  /** Names the app GitHub suggests at setup, so two machines' apps can be told apart. */
  machineName?: string;
}
export type TokenResult = { ok: true; token: string } | { ok: false; kind: "auth" | "install"; message: string };

/** A setup failure the person fixes by starting again. The message says how. */
export class GitHubAppError extends Error {}

const CreatedAppSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }), slug: Type.String({ minLength: 1 }), client_id: Type.String({ minLength: 1 }),
  html_url: Type.String({ pattern: "^https://" }), pem: Type.String({ minLength: 1 }),
  owner: Type.Object({ login: Type.String({ minLength: 1 }) }),
});
const InstallationSchema = Type.Object({ id: Type.Integer({ minimum: 1 }) });
const AccessTokenSchema = Type.Object({ token: Type.String({ minLength: 1 }), expires_at: Type.String() });

/**
 * Forgerie's own GitHub App: created once through GitHub's manifest flow, installed by a person on the
 * repos it may read, and used as itself. Its private key signs 10-minute app tokens, which Forgerie trades
 * for 1-hour installation tokens per repo. No person logs in, and nothing expires while the key is valid.
 */
export class GitHubApp {
  private readonly pending = new Map<string, number>();
  private readonly installations = new Map<string, { id: number } | { missingUntil: number }>();
  private readonly tokens = new Map<number, { token: string; expiresAt: number }>();
  private readonly minting = new Map<number, Promise<string>>();
  private readonly now: () => number;
  constructor(private readonly deps: GitHubAppDependencies) { this.now = deps.now ?? Date.now; }

  status(): GitHubAppStatus {
    const app = this.deps.store.read();
    if (app === undefined) return { state: "not-configured" };
    return { state: "configured", app: { slug: app.slug, owner: app.owner, url: app.url }, installUrl: installUrl(app.slug) };
  }

  /**
   * The form that asks GitHub to create the app. `origin` is the browser's own address: GitHub sends the
   * person back there with a one-hour code, and to the backlog after each install.
   */
  startSetup(origin: string): GitHubSetupStart {
    let base: string;
    try { base = new URL(origin).origin; } catch { throw new GitHubAppError("Forgerie needs its own web address to set up GitHub."); }
    for (const [state, until] of this.pending) if (until <= this.now()) this.pending.delete(state);
    const state = `forgerie-${randomBytes(16).toString("hex")}`;
    this.pending.set(state, this.now() + SETUP_WINDOW_MS);
    const name = `Forgerie (${this.deps.machineName ?? hostname()})`.slice(0, 34);
    const manifest = {
      name, url: base.startsWith("https://") ? base : GITHUB_WEB,
      description: "Lists issues in Forgerie's backlog, and lets Forgerie's agents work on issues and pull requests.",
      // The app must be public to install it on an organization that does not own it.
      // With no webhook and no user login, being public gives nobody else access to anything.
      public: true,
      redirect_url: `${base}/`,
      setup_url: `${base}/?backlog`, setup_on_update: true,
      // Agents comment, close, and label issues, open pull requests, read CI, and merge when CI passes.
      default_permissions: { issues: "write", pull_requests: "write", contents: "write", checks: "read", statuses: "read", actions: "write" }, default_events: [],
    };
    return { action: `${GITHUB_WEB}/settings/apps/new?state=${state}`, manifest: JSON.stringify(manifest) };
  }

  /** Trades GitHub's one-hour code for the app's identity and key, and keeps only what reading needs. */
  async finishSetup({ code, state }: GitHubCreatedRequest): Promise<GitHubAppStatus> {
    const until = this.pending.get(state);
    if (until === undefined || until <= this.now()) {
      throw new GitHubAppError("This GitHub setup did not start here, or it is older than an hour. Start the setup again.");
    }
    this.pending.delete(state);
    const response = await this.deps.fetch(`${GITHUB_API}/app-manifests/${encodeURIComponent(code)}/conversions`, { method: "POST", headers: baseHeaders() });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok || !Check(CreatedAppSchema, body)) {
      throw new GitHubAppError(`GitHub did not hand over the new app (HTTP ${String(response.status)}). Its code lasts one hour and works once. Start the setup again.`);
    }
    // The client secret and webhook secret are dropped here: Forgerie needs neither.
    await this.deps.store.write({ id: body.id, slug: body.slug, clientId: body.client_id, owner: body.owner.login, url: body.html_url, privateKey: body.pem });
    this.forget();
    return this.status();
  }

  /** Forgets the app on this machine. It stays on GitHub until its owner deletes it there. */
  async remove(): Promise<GitHubAppStatus> {
    await this.deps.store.write(undefined);
    this.forget();
    return this.status();
  }

  /** The app's install page, for access messages. */
  installUrl(): string | undefined {
    const app = this.deps.store.read();
    return app === undefined ? undefined : installUrl(app.slug);
  }

  /**
   * A token that reads `repo` (`owner/name`), or why there is none. Throws only when GitHub cannot be
   * reached, so a caller can keep its last good result.
   */
  async tokenFor(repo: string): Promise<TokenResult> {
    const app = this.deps.store.read();
    if (app === undefined) return { ok: false, kind: "auth", message: `Set up GitHub in the backlog to list issues for ${repo}.` };
    const key = repo.toLowerCase();
    let installation = this.installations.get(key);
    if (installation !== undefined && "missingUntil" in installation && installation.missingUntil <= this.now()) installation = undefined;
    if (installation === undefined) {
      const response = await this.deps.fetch(`${GITHUB_API}/repos/${repo}/installation`, { headers: { ...baseHeaders(), Authorization: `Bearer ${this.jwt(app)}` } });
      if (response.status === 401) return rejected();
      if (response.status === 404) installation = { missingUntil: this.now() + MISSING_INSTALL_MS };
      else {
        const body: unknown = await response.json().catch(() => undefined);
        if (!response.ok || !Check(InstallationSchema, body)) throw new Error(`GitHub answered HTTP ${String(response.status)} for the app's installation on ${repo}`);
        installation = { id: body.id };
      }
      this.installations.set(key, installation);
    }
    if ("missingUntil" in installation) return notInstalled(repo, app);
    const cached = this.tokens.get(installation.id);
    if (cached !== undefined && cached.expiresAt - TOKEN_MARGIN_MS > this.now()) return { ok: true, token: cached.token };
    const id = installation.id;
    // One mint per installation at a time; overlapping scans share it.
    let mint = this.minting.get(id);
    if (mint === undefined) {
      mint = this.mint(app, id).finally(() => this.minting.delete(id));
      this.minting.set(id, mint);
    }
    const token = await mint;
    if (token === "gone") { this.installations.delete(key); return notInstalled(repo, app); }
    if (token === "rejected") return rejected();
    return { ok: true, token };
  }

  /** GitHub refused a token for `repo`: the next read mints a new one and looks the installation up again. */
  dropToken(repo: string): void {
    const installation = this.installations.get(repo.toLowerCase());
    if (installation !== undefined && "id" in installation) this.tokens.delete(installation.id);
    this.installations.delete(repo.toLowerCase());
  }

  private async mint(app: StoredGitHubApp, id: number): Promise<string> {
    const response = await this.deps.fetch(`${GITHUB_API}/app/installations/${String(id)}/access_tokens`, {
      method: "POST", headers: { ...baseHeaders(), Authorization: `Bearer ${this.jwt(app)}` },
    });
    if (response.status === 401) return "rejected";
    if (response.status === 404) return "gone";
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok || !Check(AccessTokenSchema, body)) throw new Error(`GitHub answered HTTP ${String(response.status)} for an installation token`);
    const expiresAt = Date.parse(body.expires_at);
    this.tokens.set(id, { token: body.token, expiresAt: Number.isFinite(expiresAt) ? expiresAt : this.now() + 60 * 60_000 });
    return body.token;
  }

  /** A 10-minute app token, as GitHub asks: RS256, issued a minute early against clock drift, issuer the client ID. */
  private jwt(app: StoredGitHubApp): string {
    const seconds = Math.floor(this.now() / 1000);
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: seconds - 60, exp: seconds + 9 * 60, iss: app.clientId })}`;
    return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(app.privateKey).toString("base64url")}`;
  }

  private forget(): void { this.installations.clear(); this.tokens.clear(); this.minting.clear(); }
}

/** The login GitHub gives a configured app's own account, such as `forgerie-zao[bot]`. */
export function appBotLogin(status: GitHubAppStatus): string | undefined {
  return status.state === "configured" ? `${status.app.slug}[bot]` : undefined;
}

export function installUrl(slug: string): string { return `${GITHUB_WEB}/apps/${slug}/installations/new`; }
export function baseHeaders(): Record<string, string> {
  return { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": GITHUB_API_VERSION };
}
export function apiHeaders(token: string): Record<string, string> { return { ...baseHeaders(), Authorization: `Bearer ${token}` }; }

function notInstalled(repo: string, app: StoredGitHubApp): TokenResult {
  return { ok: false, kind: "install", message: `Forgerie's GitHub App is not installed on ${repo}. Install it there: ${installUrl(app.slug)} If the repo name is wrong, set backlog.github.repo in .forgerie/config.json.` };
}
function rejected(): TokenResult {
  return { ok: false, kind: "auth", message: "GitHub no longer accepts Forgerie's GitHub App: it was deleted, or its key was revoked. Remove it in the backlog and set GitHub up again." };
}
