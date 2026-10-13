import { execFile, type ExecFileOptions } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { AzureDevopsPatStore } from "./azureDevopsPat.js";

export type AzureAuthorization = { ok: true; authorization: string } | { ok: false; message: string };
export interface AzureCredentialSource {
  read(organization: string): Promise<AzureAuthorization>;
  invalidate(rejectedAuthorization: string): void;
  fixMessage(organization: string): string;
}
export type AzureCliRunner = (command: string, args: readonly string[], options: ExecFileOptions & { env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number }) => Promise<string>;
const execute = promisify(execFile);
const runCli: AzureCliRunner = async (command, args, options) => (await execute(command, [...args], { ...options, encoding: "utf8" })).stdout;
const TokenSchema = Type.Object({
  accessToken: Type.String({ minLength: 20, maxLength: 128 * 1024, pattern: "^[A-Za-z0-9._~+/-]+={0,2}$" }),
  expires_on: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.String({ pattern: "^[0-9]+$" })])),
  expiresOn: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?$" })),
});
const REFRESH_MARGIN_MS = 5 * 60_000;
interface Dependencies {
  directory: string;
  azureCliCommand?: string;
  runner?: AzureCliRunner;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
}

/** One daemon-owned credential source for both Azure readers. Only CLI access tokens are cached. */
export class AzureDevopsCredentials implements AzureCredentialSource {
  private readonly pat: AzureDevopsPatStore;
  private readonly now: () => number;
  private cached: { authorization: string; refreshAt: number } | undefined;
  private refreshing: Promise<AzureAuthorization> | undefined;
  constructor(private readonly deps: Dependencies) {
    this.pat = new AzureDevopsPatStore(deps.directory);
    this.now = deps.now ?? Date.now;
  }
  fixMessage(organization: string): string {
    return `Run \`az login\` as the Forgerie user, or put a PAT in ${join(this.deps.directory, `${organization.toLowerCase()}.pat`)}.`;
  }
  invalidate(rejectedAuthorization: string): void {
    // A late 401 for the previous token must not discard a concurrent refresh's new token.
    if (this.cached?.authorization === rejectedAuthorization) this.cached = undefined;
  }
  async read(organization: string): Promise<AzureAuthorization> {
    const pat = await this.pat.read(organization);
    if (pat.ok) return { ok: true, authorization: pat.authorization };
    if (pat.kind !== "missing") return { ok: false, message: pat.message };
    if (this.cached !== undefined && this.now() < this.cached.refreshAt) return { ok: true, authorization: this.cached.authorization };
    const pending = this.refreshing ?? this.refresh();
    this.refreshing = pending;
    try {
      const result = await pending;
      return result.ok ? result : { ok: false, message: `${result.message} ${this.fixMessage(organization)}` };
    } finally { if (this.refreshing === pending) this.refreshing = undefined; }
  }
  private async refresh(): Promise<AzureAuthorization> {
    let extensionDir: string | undefined;
    try {
      extensionDir = await mkdtemp(join(tmpdir(), "forgerie-azure-extensions-"));
      const output = await (this.deps.runner ?? runCli)(this.deps.azureCliCommand ?? "az", ["account", "get-access-token", "--resource", "499b84ac-1321-427f-aa17-267ca6975798", "-o", "json"], {
        env: { ...(this.deps.env ?? process.env), AZURE_EXTENSION_DIR: extensionDir }, shell: false, timeout: 30_000, maxBuffer: 256 * 1024,
      });
      const value: unknown = JSON.parse(output);
      if (!Check(TokenSchema, value)) return this.failed("Azure CLI returned invalid token data.");
      // expiresOn is local time in the CLI's timezone. Do not append Z. Epoch seconds take priority.
      const expiry = value.expires_on === undefined ? Date.parse(value.expiresOn ?? "") : Number(value.expires_on) * 1000;
      if (!Number.isFinite(expiry) || expiry <= this.now()) return this.failed("Azure CLI returned an expired or invalid expiry.");
      const authorization = `Bearer ${value.accessToken}`;
      this.cached = { authorization, refreshAt: expiry - REFRESH_MARGIN_MS };
      return { ok: true, authorization };
    } catch (error) {
      // Never forward stdout, exception messages, stack/cause, or unfiltered CLI stderr.
      const timeout = typeof error === "object" && error !== null && "killed" in error && error.killed === true;
      return this.failed(timeout ? "Azure CLI did not finish within 30 seconds." : `Azure CLI could not provide credentials.${safeCliError(error)}`);
    } finally {
      if (extensionDir !== undefined) await rm(extensionDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  private failed(reason: string): AzureAuthorization { return { ok: false, message: reason }; }
}

function safeCliError(error: unknown): string {
  if (typeof error !== "object" || error === null || !("stderr" in error) || typeof error.stderr !== "string") return "";
  const line = error.stderr.split(/\r?\n/u).map((item) => item.trim()).find((item) => item.startsWith("ERROR:"));
  if (line === undefined) return "";
  const safe = line.replace(/\b(?:Bearer|Basic)\s+\S+/giu, "[redacted]")
    .replace(/(?:accessToken|access_token|refresh_token|id_token|token)\s*[=:]\s*(?:"[^"]*"|'[^']*'|\S+)/giu, "token=[redacted]")
    .replace(/[A-Za-z0-9+/_=.~-]{20,}/gu, "[redacted]");
  return ` ${safe.slice(0, 512)}`;
}
