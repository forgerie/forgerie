import { Type, type Static } from "typebox";

/**
 * Forgerie reads GitHub as its own GitHub App, not as a person. The app is created once from the
 * backlog (GitHub's manifest flow) and installed on the repos it may read. Nothing here is secret:
 * the app's private key stays in the session daemon.
 */
export const GitHubAppStatusSchema = Type.Union([
  Type.Object({ state: Type.Literal("not-configured") }, { additionalProperties: false }),
  Type.Object({
    state: Type.Literal("configured"),
    app: Type.Object({
      slug: Type.String({ minLength: 1 }),
      /** The account that owns the app registration. */
      owner: Type.String({ minLength: 1 }),
      /** The app's public page. */
      url: Type.String({ pattern: "^https://" }),
    }, { additionalProperties: false }),
    /** Where a person chooses the accounts and repos the app may read. */
    installUrl: Type.String({ pattern: "^https://" }),
  }, { additionalProperties: false }),
]);
export type GitHubAppStatus = Static<typeof GitHubAppStatusSchema>;

/** The browser's own origin. GitHub sends the person back here after each step. */
export const GitHubSetupRequestSchema = Type.Object({ origin: Type.String({ pattern: "^https?://", maxLength: 2048 }) }, { additionalProperties: false });

/** A form the browser posts to GitHub: `manifest` goes in a field of that name. */
export const GitHubSetupStartSchema = Type.Object({
  action: Type.String({ pattern: "^https://github\\.com/settings/apps/new\\?state=" }),
  manifest: Type.String({ minLength: 2 }),
}, { additionalProperties: false });
export type GitHubSetupStart = Static<typeof GitHubSetupStartSchema>;

/** What GitHub adds to the return address after the person creates the app. */
export const GitHubCreatedRequestSchema = Type.Object({
  code: Type.String({ pattern: "^[A-Za-z0-9._-]{1,200}$" }),
  state: Type.String({ pattern: "^forgerie-[a-f0-9]{32}$" }),
}, { additionalProperties: false });
export type GitHubCreatedRequest = Static<typeof GitHubCreatedRequestSchema>;

export const GitHubErrorSchema = Type.Object({ error: Type.String() }, { additionalProperties: false });
