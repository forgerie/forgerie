import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { GitHubAppSchema } from "../../shared/github.js";

const token = Type.String({ minLength: 1, maxLength: 4096 });
export const GitHubLoginSchema = Type.Object({
  login: Type.String({ minLength: 1, maxLength: 100 }),
  accessToken: token,
  /** ISO time. Absent when the app does not expire user tokens. */
  accessTokenExpiresAt: Type.Optional(Type.String()),
  refreshToken: Type.Optional(token),
  refreshTokenExpiresAt: Type.Optional(Type.String()),
}, { additionalProperties: false });
export type GitHubLogin = Static<typeof GitHubLoginSchema>;

const FileSchema = Type.Object({
  version: Type.Literal(1),
  app: Type.Optional(GitHubAppSchema),
  login: Type.Optional(GitHubLoginSchema),
}, { additionalProperties: false });
export type GitHubAuthState = Static<typeof FileSchema>;

/**
 * The one file that holds GitHub credentials. Owner-only (0600), replaced atomically,
 * and read only by the session daemon. Nothing in it is ever sent to a browser.
 */
export class GitHubAuthStore {
  private state: GitHubAuthState = { version: 1 };
  constructor(private readonly path?: string) {}

  async initialize(): Promise<void> {
    if (this.path === undefined) return;
    let value: unknown;
    try { value = JSON.parse(await readFile(this.path, "utf8")); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return; throw error; }
    if (!Check(FileSchema, value)) throw new Error(`Invalid GitHub login file: ${this.path}`);
    // Tighten a file someone loosened by hand; the tokens are bearer credentials.
    await chmod(this.path, 0o600);
    this.state = value;
  }
  read(): GitHubAuthState { return structuredClone(this.state); }
  async write(next: GitHubAuthState): Promise<void> {
    if (!Check(FileSchema, next)) throw new Error("Invalid GitHub login state");
    if (this.path !== undefined) {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
        await rename(temporary, this.path);
      } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
    }
    this.state = structuredClone(next);
  }
}
