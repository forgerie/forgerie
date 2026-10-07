import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";

export const StoredGitHubAppSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  slug: Type.String({ minLength: 1, maxLength: 100 }),
  clientId: Type.String({ minLength: 1, maxLength: 100 }),
  owner: Type.String({ minLength: 1, maxLength: 100 }),
  url: Type.String({ pattern: "^https://" }),
  /** The app's private key (PEM). It signs the short tokens Forgerie trades for 1-hour installation tokens. */
  privateKey: Type.String({ minLength: 1, maxLength: 16_384 }),
}, { additionalProperties: false });
export type StoredGitHubApp = Static<typeof StoredGitHubAppSchema>;

const FileSchema = Type.Object({ version: Type.Literal(1), app: Type.Optional(StoredGitHubAppSchema) }, { additionalProperties: false });

/**
 * The one file that holds Forgerie's GitHub App and its private key. Owner-only (0600), replaced
 * atomically, read only by the session daemon. Nothing in it is ever sent to a browser.
 */
export class GitHubAppStore {
  private app: StoredGitHubApp | undefined;
  constructor(private readonly path?: string) {}

  async initialize(): Promise<void> {
    if (this.path === undefined) return;
    let value: unknown;
    try { value = JSON.parse(await readFile(this.path, "utf8")); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return; throw error; }
    if (!Check(FileSchema, value)) throw new Error(`Invalid GitHub App file: ${this.path}`);
    // Tighten a file someone loosened by hand; the key reads every repo the app is installed on.
    await chmod(this.path, 0o600);
    this.app = value.app;
  }
  read(): StoredGitHubApp | undefined { return this.app === undefined ? undefined : { ...this.app }; }
  async write(app: StoredGitHubApp | undefined): Promise<void> {
    const next = { version: 1 as const, ...(app === undefined ? {} : { app }) };
    if (!Check(FileSchema, next)) throw new Error("Invalid GitHub App state");
    if (this.path !== undefined) {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
        await rename(temporary, this.path);
      } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
    }
    this.app = app === undefined ? undefined : { ...app };
  }
}
