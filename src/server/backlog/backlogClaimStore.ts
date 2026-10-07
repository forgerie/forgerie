import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { BacklogClaimSchema, type BacklogClaim } from "../../shared/backlog.js";
import { BacklogError, isMissingFile } from "./backlogError.js";

const FileSchema = Type.Object({ version: Type.Literal(1), claims: Type.Array(BacklogClaimSchema) }, { additionalProperties: false });
type Reservation = Extract<BacklogClaim, { kind: "launching" }>;

/** Single daemon owner; serialize mutations and publish only after atomic disk replacement. */
export class BacklogClaimStore {
  private claims: BacklogClaim[] = [];
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly path?: string) {}

  async initialize(): Promise<void> {
    if (this.path === undefined) return;
    let value: unknown;
    try { value = JSON.parse(await readFile(this.path, "utf8")); }
    catch (error) { if (isMissingFile(error)) return; throw error; }
    if (!Check(FileSchema, value)) throw new Error("Invalid backlog claim file");
    const identities = value.claims.map((claim) => JSON.stringify([claim.repo, claim.itemId]));
    if (new Set(identities).size !== identities.length || new Set(value.claims.map((claim) => claim.claimId)).size !== identities.length) throw new Error("Duplicate backlog claims");
    this.claims = value.claims;
    // A killed launch is not still running. Retain ownership until explicit guarded recovery.
    if (this.claims.some((claim) => claim.kind === "launching")) {
      await this.persist(this.claims.map((claim) => claim.kind === "launching" ? { ...claim, kind: "interrupted" } : claim));
    }
  }
  list(): Promise<BacklogClaim[]> { return Promise.resolve(structuredClone(this.claims)); }
  get(repo: string, itemId: string): Promise<BacklogClaim | undefined> {
    return Promise.resolve(structuredClone(this.claims.find((claim) => claim.repo === repo && claim.itemId === itemId)));
  }
  reserve(input: Omit<Reservation, "kind" | "claimId" | "claimedAt">): Promise<Reservation> {
    return this.exclusive(async () => {
      const existing = await this.get(input.repo, input.itemId);
      if (existing !== undefined) throw new BacklogError("conflict", "Backlog item already has a claim", existing);
      const claim: Reservation = { ...input, kind: "launching", claimId: randomUUID(), claimedAt: new Date().toISOString() };
      await this.persist([...this.claims, claim]);
      return structuredClone(claim);
    });
  }
  bind(claimId: string, sessionId: string, cwd: string, branch?: string): Promise<Extract<BacklogClaim, { kind: "claimed" }>> {
    return this.exclusive(async () => {
      const reservation = this.claims.find((claim) => claim.claimId === claimId);
      if (reservation?.kind !== "launching") throw new BacklogError("conflict", "Launch reservation changed");
      const claim = { ...reservation, kind: "claimed" as const, sessionId, cwd, ...(branch === undefined ? {} : { branch }) };
      await this.persist(this.claims.map((record) => record.claimId === claimId ? claim : record));
      return structuredClone(claim);
    });
  }
  release(repo: string, itemId: string, claimId: string, allowLaunching = false): Promise<void> {
    return this.exclusive(async () => {
      const current = await this.get(repo, itemId);
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
  private async persist(claims: BacklogClaim[]): Promise<void> {
    if (!Check(FileSchema, { version: 1, claims })) throw new Error("Invalid backlog claim mutation");
    if (this.path !== undefined) {
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify({ version: 1, claims }, null, 2)}\n`, { mode: 0o600 });
        await rename(temporary, this.path);
      } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
    }
    this.claims = structuredClone(claims);
  }
}
