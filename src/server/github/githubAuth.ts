import { Type } from "typebox";
import { Check } from "typebox/value";
import type { GitHubApp, GitHubAuthStatus } from "../../shared/github.js";
import type { GitHubAuthStore, GitHubLogin } from "./githubAuthStore.js";

export const GITHUB_WEB = "https://github.com";
export const GITHUB_API = "https://api.github.com";
export const GITHUB_API_VERSION = "2026-03-10";
/** Refresh this long before the access token expires, so a scan never starts with a token about to die. */
const REFRESH_MARGIN_MS = 5 * 60_000;

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
export interface GitHubAuthDependencies {
  store: GitHubAuthStore;
  fetch: Fetch;
  now?: () => number;
  /** Resolves after `ms`, or rejects when `signal` aborts. Injected so tests do not wait in real time. */
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  log?: { warn: (object: object, message: string) => void };
}

/** A login failure the user fixes, such as a disabled device flow. The message names the fix. */
export class GitHubAuthError extends Error {}

const DeviceCodeSchema = Type.Object({
  device_code: Type.String({ minLength: 1 }), user_code: Type.String({ minLength: 1 }),
  verification_uri: Type.String({ pattern: "^https://" }), expires_in: Type.Number({ minimum: 1 }), interval: Type.Number({ minimum: 0 }),
});
const TokenSchema = Type.Object({
  access_token: Type.String({ minLength: 1 }),
  expires_in: Type.Optional(Type.Number()),
  refresh_token: Type.Optional(Type.String({ minLength: 1 })),
  refresh_token_expires_in: Type.Optional(Type.Number()),
});
const OAuthErrorSchema = Type.Object({ error: Type.String(), error_description: Type.Optional(Type.String()), interval: Type.Optional(Type.Number()) });
const UserSchema = Type.Object({ login: Type.String({ minLength: 1 }) });

interface PendingLogin { app: GitHubApp; userCode: string; verificationUri: string; expiresAt: number; controller: AbortController }

/**
 * Forgerie's login to GitHub through a GitHub App's device flow. Owns the pending login, the stored
 * tokens, and their refresh. The app's client ID is public, and device-flow tokens refresh without the
 * app's secret, so Forgerie never holds one.
 */
export class GitHubAuth {
  private pending: PendingLogin | undefined;
  private refreshing: Promise<string | undefined> | undefined;
  /** Why the last login ended, shown until the next login starts. Never persisted. */
  private reason: string | undefined;
  private readonly now: () => number;
  private readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
  constructor(private readonly deps: GitHubAuthDependencies) {
    this.now = deps.now ?? Date.now;
    this.wait = deps.wait ?? waitFor;
  }

  status(): GitHubAuthStatus {
    const { app, login } = this.deps.store.read();
    if (app === undefined) return { state: "not-configured" };
    if (this.pending !== undefined && this.pending.expiresAt > this.now()) {
      return { state: "pending", app, userCode: this.pending.userCode, verificationUri: this.pending.verificationUri, expiresAt: new Date(this.pending.expiresAt).toISOString() };
    }
    if (login !== undefined) {
      const loginExpiresAt = login.refreshTokenExpiresAt ?? (login.refreshToken === undefined ? login.accessTokenExpiresAt : undefined);
      return { state: "connected", app, login: login.login, ...(loginExpiresAt === undefined ? {} : { loginExpiresAt }) };
    }
    return { state: "disconnected", app, ...(this.reason === undefined ? {} : { reason: this.reason }) };
  }

  /** Records which GitHub App to log in through. A different app invalidates the current login. */
  async configure(app: GitHubApp): Promise<GitHubAuthStatus> {
    const current = this.deps.store.read();
    const sameApp = current.app?.clientId === app.clientId;
    this.cancelPending();
    await this.deps.store.write({ version: 1, app, ...(sameApp && current.login !== undefined ? { login: current.login } : {}) });
    return this.status();
  }

  /** Starts a device-flow login and returns at once with the code the user enters on github.com. */
  async startLogin(): Promise<GitHubAuthStatus> {
    const { app } = this.deps.store.read();
    if (app === undefined) throw new GitHubAuthError("Set up the Forgerie GitHub App before logging in.");
    this.cancelPending();
    this.reason = undefined;
    const body = await this.post(`${GITHUB_WEB}/login/device/code`, { client_id: app.clientId });
    if (!Check(DeviceCodeSchema, body)) throw new GitHubAuthError(oauthMessage(body, "GitHub did not start a device login"));
    const controller = new AbortController();
    const pending: PendingLogin = { app, userCode: body.user_code, verificationUri: body.verification_uri, expiresAt: this.now() + body.expires_in * 1000, controller };
    this.pending = pending;
    void this.poll(pending, body.device_code, body.interval).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      this.reason = error instanceof Error ? error.message : String(error);
      this.deps.log?.warn({ err: error }, "GitHub login failed");
    }).finally(() => { if (this.pending === pending) this.pending = undefined; });
    return this.status();
  }

  /**
   * Forgets the stored login. GitHub still lists the authorization until the user revokes it at
   * github.com/settings/apps/authorizations; revoking from here would need the app's secret.
   */
  async disconnect(): Promise<GitHubAuthStatus> {
    this.cancelPending();
    const { app } = this.deps.store.read();
    await this.deps.store.write({ version: 1, ...(app === undefined ? {} : { app }) });
    this.reason = undefined;
    return this.status();
  }

  /** A usable access token, refreshed first when it is about to expire. Undefined when nobody is logged in. */
  accessToken(): Promise<string | undefined> {
    const { login } = this.deps.store.read();
    if (login === undefined) return Promise.resolve(undefined);
    if (!this.expiresSoon(login.accessTokenExpiresAt)) return Promise.resolve(login.accessToken);
    // One refresh at a time: a refresh token is single use, so a second concurrent refresh would fail.
    this.refreshing ??= this.refresh(login).finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  /** The current login, for cache keys. Never a token. */
  loginName(): string | undefined { return this.deps.store.read().login?.login; }

  /** GitHub rejected the token outright. Drop it so the panel asks for a new login instead of failing on every scan. */
  async rejectToken(accessToken: string): Promise<void> {
    const state = this.deps.store.read();
    if (state.login?.accessToken !== accessToken) return;
    this.reason = "GitHub no longer accepts Forgerie's login. It was revoked or expired.";
    await this.deps.store.write({ version: 1, ...(state.app === undefined ? {} : { app: state.app }) });
  }

  private async refresh(login: GitHubLogin): Promise<string | undefined> {
    const { app } = this.deps.store.read();
    if (app === undefined) return undefined;
    if (login.refreshToken === undefined || this.expiresSoon(login.refreshTokenExpiresAt)) {
      await this.endLogin(app, "Forgerie's GitHub login expired.");
      return undefined;
    }
    const body = await this.post(`${GITHUB_WEB}/login/oauth/access_token`, { client_id: app.clientId, grant_type: "refresh_token", refresh_token: login.refreshToken });
    if (!Check(TokenSchema, body)) {
      // A refused refresh token never works again; a network failure throws above and keeps the login.
      await this.endLogin(app, oauthMessage(body, "GitHub refused to renew Forgerie's login"));
      return undefined;
    }
    const next = this.loginFrom(login.login, body);
    // Write before use: the old refresh token is already spent, so losing this write would lose the login.
    await this.deps.store.write({ version: 1, app, login: next });
    return next.accessToken;
  }

  private async poll(pending: PendingLogin, deviceCode: string, interval: number): Promise<void> {
    let delay = Math.max(interval, 1) * 1000;
    while (this.now() < pending.expiresAt) {
      await this.wait(delay, pending.controller.signal);
      const body = await this.post(`${GITHUB_WEB}/login/oauth/access_token`, { client_id: pending.app.clientId, device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
      if (Check(TokenSchema, body)) {
        const login = await this.userLogin(body.access_token);
        if (pending.controller.signal.aborted) return;
        // The app may have changed while the user approved; a token for another app must not be kept.
        if (this.deps.store.read().app?.clientId !== pending.app.clientId) return;
        await this.deps.store.write({ version: 1, app: pending.app, login: this.loginFrom(login, body) });
        return;
      }
      if (!Check(OAuthErrorSchema, body)) throw new GitHubAuthError("GitHub sent an unexpected login reply.");
      if (body.error === "authorization_pending") continue;
      // GitHub's slow_down adds five seconds and says the new interval; obey it or be rate limited.
      if (body.error === "slow_down") { delay = (body.interval ?? delay / 1000 + 5) * 1000; continue; }
      throw new GitHubAuthError(oauthMessage(body, "GitHub login failed"));
    }
    throw new GitHubAuthError("The GitHub login code expired before it was entered. Start the login again.");
  }

  private async userLogin(accessToken: string): Promise<string> {
    const response = await this.deps.fetch(`${GITHUB_API}/user`, { headers: apiHeaders(accessToken) });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok || !Check(UserSchema, body)) throw new GitHubAuthError(`GitHub did not say who logged in (HTTP ${String(response.status)}).`);
    return body.login;
  }

  private loginFrom(login: string, token: { access_token: string; expires_in?: number; refresh_token?: string; refresh_token_expires_in?: number }): GitHubLogin {
    const at = (seconds: number | undefined) => seconds === undefined ? undefined : new Date(this.now() + seconds * 1000).toISOString();
    const accessTokenExpiresAt = at(token.expires_in);
    const refreshTokenExpiresAt = at(token.refresh_token_expires_in);
    return {
      login, accessToken: token.access_token,
      ...(accessTokenExpiresAt === undefined ? {} : { accessTokenExpiresAt }),
      ...(token.refresh_token === undefined ? {} : { refreshToken: token.refresh_token }),
      ...(refreshTokenExpiresAt === undefined ? {} : { refreshTokenExpiresAt }),
    };
  }

  private async endLogin(app: GitHubApp, reason: string): Promise<void> {
    this.reason = reason;
    await this.deps.store.write({ version: 1, app });
  }
  private expiresSoon(iso: string | undefined): boolean {
    return iso !== undefined && Date.parse(iso) - this.now() < REFRESH_MARGIN_MS;
  }
  private cancelPending(): void {
    this.pending?.controller.abort();
    this.pending = undefined;
  }
  /** GitHub's OAuth endpoints answer errors with HTTP 200 and an `error` field, so callers must check the body. */
  private async post(url: string, form: Record<string, string>): Promise<unknown> {
    const response = await this.deps.fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok && !Check(OAuthErrorSchema, body)) throw new Error(`GitHub login request failed: HTTP ${String(response.status)}`);
    return body;
  }
}

export function apiHeaders(accessToken: string): Record<string, string> {
  return { Accept: "application/vnd.github+json", Authorization: `Bearer ${accessToken}`, "X-GitHub-Api-Version": GITHUB_API_VERSION };
}

function oauthMessage(body: unknown, fallback: string): string {
  if (!Check(OAuthErrorSchema, body)) return `${fallback}.`;
  if (body.error === "device_flow_disabled") return "Device flow is off for this GitHub App. Turn on \"Enable Device Flow\" in the app's settings, then log in again.";
  if (body.error === "access_denied") return "The GitHub login was cancelled on github.com.";
  if (body.error === "expired_token") return "The GitHub login code expired before it was entered. Start the login again.";
  if (body.error === "incorrect_client_credentials") return "GitHub does not recognize the client ID. Check it against the app's settings page.";
  if (body.error === "bad_refresh_token") return "GitHub refused to renew Forgerie's login. Log in again.";
  return `${fallback}: ${body.error_description ?? body.error}.`;
}

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error("aborted")); return; }
    const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, ms);
    const stop = () => { clearTimeout(timer); reject(new Error("aborted")); };
    signal.addEventListener("abort", stop, { once: true });
  });
}
