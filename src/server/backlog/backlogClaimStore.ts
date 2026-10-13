import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { BacklogClaimSchema, BacklogLaunchContentSchema, type BacklogClaim, type BacklogProviderId, type BacklogLaunchContent } from "../../shared/backlog.js";
import { BacklogError, isMissingFile } from "./backlogError.js";

const FileSchema = Type.Object({ version: Type.Literal(1), claims: Type.Array(BacklogClaimSchema),
  launchContents: Type.Optional(Type.Record(Type.String(), BacklogLaunchContentSchema)),
}, { additionalProperties: false });
type Reservation = Extract<BacklogClaim, { kind: "launching" }>;
/** An item's identity across providers. The same id from two providers is two items. */
export interface BacklogItemKey { repo: string; provider: BacklogProviderId; itemId: string }
const sameItem = (claim: BacklogClaim, key: BacklogItemKey) => claim.repo === key.repo && claim.provider === key.provider && claim.itemId === key.itemId;
/** Claims written before providers existed carry no provider; every one of them was markdown. */
const withProvider = (value: unknown): unknown => {
  if (typeof value !== "object" || value === null || !("claims" in value) || !Array.isArray(value.claims)) return value;
  return { ...value, claims: value.claims.map((claim: unknown) => typeof claim === "object" && claim !== null && !("provider" in claim) ? { ...claim, provider: "markdown" } : claim) };
};

/** Single daemon owner; serialize mutations and publish only after atomic disk replacement. */
export class BacklogClaimStore {
  private claims: BacklogClaim[] = [];
  private launchContents: Record<string, BacklogLaunchContent> = {};
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly path?: string) {}

  async initialize(): Promise<void> {
    if (this.path === undefined) return;
    let value: unknown;
    try { value = withProvider(JSON.parse(await readFile(this.path, "utf8"))); }
    catch (error) { if (isMissingFile(error)) return; throw error; }
    if (!Check(FileSchema, value)) throw new Error("Invalid backlog claim file");
    const identities = value.claims.map((claim) => JSON.stringify([claim.repo, claim.provider, claim.itemId]));
    if (new Set(identities).size !== identities.length || new Set(value.claims.map((claim) => claim.claimId)).size !== identities.length) throw new Error("Duplicate backlog claims");
    this.claims = value.claims;
    this.launchContents = value.launchContents ?? {};
    // A killed launch is not still running. Retain ownership until explicit guarded recovery.
    if (this.claims.some((claim) => claim.kind === "launching")) {
      await this.persist(this.claims.map((claim) => claim.kind === "launching" ? { ...claim, kind: "interrupted" } : claim));
    }
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
  launchContent(claimId: string): BacklogLaunchContent | undefined { return structuredClone(this.launchContents[claimId]); }
  bind(claimId: string, sessionId: string, cwd: string, branch?: string, content?: BacklogLaunchContent): Promise<Extract<BacklogClaim, { kind: "claimed" }>> {
    return this.exclusive(async () => {
      const reservation = this.claims.find((claim) => claim.claimId === claimId);
      if (reservation?.kind !== "launching") throw new BacklogError("conflict", "Launch reservation changed");
      const claim = { ...reservation, kind: "claimed" as const, sessionId, cwd, ...(branch === undefined ? {} : { branch }) };
      await this.persist(this.claims.map((record) => record.claimId === claimId ? claim : record), content === undefined ? this.launchContents : { ...this.launchContents, [claimId]: content });
      return structuredClone(claim);
    });
  }
  release(key: BacklogItemKey, claimId: string, allowLaunching = false): Promise<void> {
    return this.exclusive(async () => {
      const current = await this.get(key);
      if (current === undefined) return;
      if (current.claimId !== claimId) throw new BacklogError("conflict", "Claim changed; refresh before releasing", current);
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
  private async persist(claims: BacklogClaim[], contents = this.launchContents): Promise<void> {
    const launchContents: Record<string, BacklogLaunchContent> = {};
    for (const claim of claims) {
      const content = contents[claim.claimId];
      if (content !== undefined) launchContents[claim.claimId] = content;
    }
    const value = { version: 1, claims, ...(Object.keys(launchContents).length === 0 ? {} : { launchContents }) };
    if (!Check(FileSchema, value)) throw new Error("Invalid backlog claim mutation");
    if (this.path !== undefined) {
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
        await rename(temporary, this.path);
      } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
    }
    this.claims = structuredClone(claims);
    this.launchContents = structuredClone(launchContents);
  }
}
