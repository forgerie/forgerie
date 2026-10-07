import { Type, type Static } from "typebox";

/** The GitHub App Forgerie logs in through. The client ID is public; Forgerie never holds the app's secret or key. */
export const GitHubAppSchema = Type.Object({
  clientId: Type.String({ pattern: "^[A-Za-z0-9._-]{8,64}$" }),
  /** From the app's public link, `https://github.com/apps/<slug>`. Used only to build the install link. */
  slug: Type.Optional(Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,99}$" })),
}, { additionalProperties: false });
export type GitHubApp = Static<typeof GitHubAppSchema>;

const text = Type.String({ minLength: 1, maxLength: 4096 });
/** What the browser may know about the GitHub login. Tokens never leave the session daemon. */
export const GitHubAuthStatusSchema = Type.Union([
  Type.Object({ state: Type.Literal("not-configured") }, { additionalProperties: false }),
  Type.Object({ state: Type.Literal("disconnected"), app: GitHubAppSchema, reason: Type.Optional(text) }, { additionalProperties: false }),
  Type.Object({
    state: Type.Literal("pending"), app: GitHubAppSchema,
    userCode: text, verificationUri: Type.String({ pattern: "^https://" }), expiresAt: text,
  }, { additionalProperties: false }),
  Type.Object({ state: Type.Literal("connected"), app: GitHubAppSchema, login: text, loginExpiresAt: Type.Optional(text) }, { additionalProperties: false }),
]);
export type GitHubAuthStatus = Static<typeof GitHubAuthStatusSchema>;

export const GitHubAuthErrorSchema = Type.Object({ error: Type.String() }, { additionalProperties: false });
