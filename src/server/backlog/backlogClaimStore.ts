import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { BacklogClaimSchema, BacklogLaunchContentSchema, type BacklogClaim, type BacklogLaunchContent } from "../../shared/backlog.js";
import { BacklogLaunchSnapshots } from "./backlogLaunchSnapshots.js";
import { BacklogError, isMissingFile } from "./backlogError.js";

import { claimKeyOf, type BacklogItemKey } from "../../shared/backlogClaimKey.js";

const FileSchema = Type.Object({ version: Type.Literal(1), claims: Type.Array(BacklogClaimSchema),
  launchContents: Type.Optional(Type.Record(Type.String(), BacklogLaunchContentSchema)),
}, { additionalProperties: false });
type Reservation = Extract<BacklogClaim, { kind: "launching" }>;
/** An item's identity across providers. The same id from two providers is two items. */
const sameItem = (claim: BacklogClaim, key: BacklogItemKey) => claimKeyOf(claim) === claimKeyOf(key);
/** Claims written before providers existed carry no provider; every one of them was markdown. */
const withProvider = (value: unknown): unknown => {
  if (typeof value !== "object" || value === null || !("claims" in value) || !Array.isArray(value.claims)) return value;
  return { ...value, claims: value.claims.map((claim: unknown) => typeof claim === "object" && claim !== null && !("provider" in claim) ? { ...claim, provider: "markdown" } : claim) };
};

/** Single daemon owner; serialize mutations and publish only after atomic disk replacement. */
export class BacklogClaimStore {
  private claims: BacklogClaim[] = [];
  private readonly snapshots: BacklogLaunchSnapshots;
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly path?: string) { this.snapshots = new BacklogLaunchSnapshots(path === undefined ? undefined : join(dirname(path), "backlog-launch")); }

  async initialize(): Promise<void> {
    if (this.path === undefined) return;
    let value: unknown;
    try { value = withProvider(JSON.parse(await readFile(this.path, "utf8"))); }
    catch (error) { if (isMissingFile(error)) { await this.snapshots.initialize([]); return; } throw error; }
    if (!Check(FileSchema, value)) throw new Error("Invalid backlog claim file");
    const identities = value.claims.filter((claim) => claim.provider !== "azure-devops").map(claimKeyOf);
    // Old Azure claims are all retained. The scan marks duplicate identity groups contested.
    if (new Set(identities).size !== identities.length || new Set(value.claims.map((claim) => claim.claimId)).size !== value.claims.length) throw new Error("Duplicate backlog claims");
    this.claims = value.claims;
    // Finish every snapshot write before removing the legacy inline payloads.
    // A failed migration leaves the old metadata intact and is safe to retry.
    for (const claim of this.claims) {
      const content = value.launchContents?.[claim.claimId];
      if (claim.kind === "claimed" && content !== undefined) await this.snapshots.write(claim.claimId, content);
    }
    // A killed launch is not still running. Retain ownership until explicit guarded recovery.
    if (value.launchContents !== undefined || this.claims.some((claim) => claim.kind === "launching")) {
      await this.persist(this.claims.map((claim) => claim.kind === "launching" ? { ...claim, kind: "interrupted" } : claim));
    }
    await this.snapshots.initialize(this.claims.filter((claim) => claim.kind === "claimed").map((claim) => claim.claimId));
  }
  list(): Promise<BacklogClaim[]> { return Promise.resolve(structuredClone(this.claims)); }
  get(key: BacklogItemKey): Promise<BacklogClaim | undefined> {
    return Promise.resolve(structuredClone(this.claims.find((claim) => sameItem(claim, key))));
  }
  reserve(input: Omit<Reservation, "kind" | "claimId" | "claimedAt">): Promise<Reservation> {
    return this.exclusive(async () => {
      const existing = await this.get(input);
      if (existing !== undefined) throw new BacklogError("conflict", "Backlog item already has a claim", existing);
      const claim: Reservation = { ...input, kind: "launching", claimId: randomUUID(), claimedAt: new Date().toISOString() };
      await this.persist([...this.claims, claim]);
      return structuredClone(claim);
    });
  }
  /** Private launch snapshot. Never included in list/detail claims. */
  async launchContent(claimId: string): Promise<BacklogLaunchContent | undefined> {
    if (!this.claims.some((claim) => claim.claimId === claimId && claim.kind === "claimed")) return undefined;
    return await this.snapshots.read(claimId);
  }
  bind(claimId: string, sessionId: string, cwd: string, branch?: string, content?: BacklogLaunchContent): Promise<Extract<BacklogClaim, { kind: "claimed" }>> {
    return this.exclusive(async () => {
      const reservation = this.claims.find((claim) => claim.claimId === claimId);
      if (reservation?.kind !== "launching") throw new BacklogError("conflict", "Launch reservation changed");
      const claim = { ...reservation, kind: "claimed" as const, sessionId, cwd, ...(branch === undefined ? {} : { branch }) };
      if (content !== undefined) await this.snapshots.write(claimId, content);
      try { await this.persist(this.claims.map((record) => record.claimId === claimId ? claim : record)); }
      catch (error) {
        // The reservation still owns the item. Startup also removes a snapshot
        // left by a crash between its write and the claim metadata commit.
        if (content !== undefined) await this.snapshots.remove([claimId]).catch(() => undefined);
        throw error;
      }
      return structuredClone(claim);
    });
  }
  /** Only the launch owner calls this, after its session has stopped. Keep the exact claim for recovery. */
  interrupt(claimId: string): Promise<void> {
    return this.exclusive(async () => {
      const reservation = this.claims.find((claim) => claim.claimId === claimId);
      if (reservation?.kind !== "launching") throw new BacklogError("conflict", "Launch reservation changed");
      await this.persist(this.claims.map((claim) => claim.claimId === claimId ? { ...reservation, kind: "interrupted" } : claim));
    });
  }
  release(key: BacklogItemKey, claimId: string, allowLaunching = false): Promise<void> {
    return this.exclusive(async () => {
      const matches = this.claims.filter((claim) => sameItem(claim, key));
      if (matches.length === 0) return;
      const current = matches.find((claim) => claim.claimId === claimId);
      if (current === undefined) throw new BacklogError("conflict", "Claim changed; refresh before releasing", matches[0]);
      if (current.kind === "launching" && !allowLaunching) throw new BacklogError("conflict", "Wait for the launch to finish", current);
      await this.persist(this.claims.filter((record) => record.claimId !== claimId));
    });
  }
  releaseSessions(sessionIds: readonly string[]): Promise<void> {
    return this.exclusive(async () => {
      const ids = new Set(sessionIds);
      const next = this.claims.filter((record) => record.kind !== "claimed" || !ids.has(record.sessionId));
      if (next.length !== this.claims.length) await this.persist(next);
    });
  }
  private async exclusive<T>(run: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release = (): void => undefined;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await run(); } finally { release(); }
  }
  private async persist(claims: BacklogClaim[]): Promise<void> {
    const value = { version: 1, claims };
    if (!Check(FileSchema, value)) throw new Error("Invalid backlog claim mutation");
    if (this.path !== undefined) {
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
        await rename(temporary, this.path);
      } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
    }
    const kept = new Set(claims.map((claim) => claim.claimId));
    const removed = this.claims.filter((claim) => !kept.has(claim.claimId)).map((claim) => claim.claimId);
    this.claims = structuredClone(claims);
    // Commit metadata first. Startup removes any orphan left if deletion fails.
    await this.snapshots.remove(removed);
  }
}
