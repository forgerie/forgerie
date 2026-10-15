import { randomUUID } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { decisionGatewayApiKeySchema, type DecisionHintsStatus } from "../../shared/decisionHints.js";

export const DECISION_GATEWAY_KEY_FILE_NAME = "decision-gateway.json";
const fileSchema = z.object({ apiKey: decisionGatewayApiKeySchema });
export class DecisionGatewayKeyError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const unreadable = () => new DecisionGatewayKeyError(500, "Cannot read the gateway key file. Repair or remove decision-gateway.json in the active agent profile.");

/** Sessiond owns this file in its active (not desired) profile. Only this module reads secrets.
 * Stat on use; parse only after a change. Inode also detects equal-size atomic replacements.
 * Errors are deliberately fixed text: filesystem and schema errors can contain secret data.
 */
export class DecisionGatewayKeyStore {
  private readonly path: string;
  private readonly environmentKey: string | undefined;
  private cached: { stamp: string; apiKey: string } | undefined;
  constructor(private readonly options: { agentDir: string; env: NodeJS.ProcessEnv; stat?: (path: string) => Promise<BigIntStats> }) {
    this.path = join(options.agentDir, DECISION_GATEWAY_KEY_FILE_NAME);
    const environmentKey = options.env["DECISION_GATEWAY_API_KEY"]?.trim();
    this.environmentKey = environmentKey === "" ? undefined : environmentKey;
  }
  async readApiKey(): Promise<string | undefined> {
    if (this.environmentKey !== undefined) return this.environmentKey;
    try {
      const info = await (this.options.stat?.(this.path) ?? stat(this.path, { bigint: true }));
      if (!info.isFile() || info.size > 32_768n) throw unreadable();
      const stamp = `${String(info.mtimeNs)}:${String(info.size)}:${String(info.ino)}`;
      if (this.cached?.stamp === stamp) return this.cached.apiKey;
      const parsed = fileSchema.safeParse(JSON.parse(await readFile(this.path, "utf8")));
      if (!parsed.success) throw unreadable();
      this.cached = { stamp, apiKey: parsed.data.apiKey };
      return parsed.data.apiKey;
    } catch (error) {
      this.cached = undefined;
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw unreadable();
    }
  }
  async status(): Promise<DecisionHintsStatus> {
    if (this.environmentKey !== undefined) return { keyPresent: true, source: "environment" };
    try { return await this.readApiKey() === undefined ? { keyPresent: false, source: "none" } : { keyPresent: true, source: "settings" }; }
    catch { return { keyPresent: false, source: "settings", invalid: true }; }
  }
  private requireEditable(): void {
    if (this.environmentKey !== undefined) throw new DecisionGatewayKeyError(409, "The key is set by DECISION_GATEWAY_API_KEY in sessiond's environment. Settings cannot replace or remove it.");
  }
  async set(value: string): Promise<void> {
    this.requireEditable();
    const parsed = decisionGatewayApiKeySchema.safeParse(value);
    if (!parsed.success) throw new DecisionGatewayKeyError(400, "Gateway key must be non-empty, at most 4096 characters, and contain no control characters.");
    const temp = `${this.path}.${randomUUID()}.tmp`;
    try {
      await mkdir(this.options.agentDir, { recursive: true });
      const file = await open(temp, "wx", 0o600);
      try {
        await file.chmod(0o600);
        await file.writeFile(`${JSON.stringify({ apiKey: parsed.data })}\n`, "utf8");
      } finally { await file.close(); }
      await rename(temp, this.path);
      this.cached = undefined;
    } catch {
      try { await rm(temp, { force: true }); }
      catch { throw new DecisionGatewayKeyError(500, "Cannot clean up the temporary gateway key file in the active agent profile."); }
      throw new DecisionGatewayKeyError(500, "Cannot save the gateway key file in the active agent profile.");
    }
  }
  async clear(): Promise<void> {
    this.requireEditable();
    try { await rm(this.path, { force: true }); this.cached = undefined; }
    catch { throw new DecisionGatewayKeyError(500, "Cannot remove the gateway key file from the active agent profile."); }
  }
}
