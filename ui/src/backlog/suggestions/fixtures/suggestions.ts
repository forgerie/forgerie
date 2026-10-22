// Backlog suggestions for parts and tests. Fixed times: a scenario never reads the clock.
import type { SessionModel } from "../../../contracts";
import type { SessionLook } from "../../backlogModel";
import type { Suggestion, SuggestionState } from "../suggestionsApi";

/** "Now" for every scenario: 16:58 on 21 October 2026, UTC. */
export const NOW = Date.parse("2026-10-21T16:58:00Z");
export const CHAT_ID = "s-chat";
export const CHAT_TITLE = "Fix the stuck tool row after a lost stream";
export const MODELS: SessionModel[] = [
  { provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5", reasoning: true },
  { provider: "anthropic", id: "claude-opus-5-5", name: "Claude Opus 5.5", reasoning: true },
  { provider: "google", id: "gemini-3-8-flash", name: "Gemini 3.8 Flash", reasoning: true },
];
export const CHAT_MODEL = MODELS[1]!;

const markdown = (slug: string) => ({ provider: "markdown" as const, path: `.forgerie/backlog/2026-10-21-${slug}.md` });
const github = { provider: "github" as const, repo: "simonwjackson/forgerie", label: "agent-filed" };

export function suggestion(id: string, over: Partial<Suggestion> = {}): Suggestion {
  return {
    id, sessionId: CHAT_ID, projectId: "p-forgerie", sessionTitle: CHAT_TITLE,
    title: "Retry once when the provider stream drops before message.end",
    body: "Today a stream that closes early ends the reply with no error, and the reader sees half an answer. Retry once from the last complete block. If the retry fails too, say so in the reply.",
    context: {
      why: "Came up while fixing the stuck tool row in this chat. The row stuck because the stream closed early. The reply has the same cause, and nothing retries it.",
      files: ["src/server/sessions/streamRelay.ts", "src/server/sessions/streamRelay.test.ts", "ui/src/transcript.ts"],
      decisions: ["Retry at most once.", "Keep the partial text. Do not send the prompt again.", "Not part of this chat's fix, which only closes the stuck rows."],
    },
    destination: markdown("retry-on-lost-stream"),
    defaultModel: { modelSpec: "anthropic/claude-haiku-4-5" },
    createdAt: "2026-10-21T16:40:00Z", revision: 1, state: { kind: "open" }, ...over,
  };
}
const at = "2026-10-21T16:44:00Z";
export const OPEN = suggestion("sg-open");
export const OPEN_GITHUB = suggestion("sg-github", { destination: github });
export const NO_DEFAULT = suggestion("sg-chat-model", { defaultModel: {} });
export const FILING = suggestion("sg-filing", { state: { kind: "filing", action: "file" } });
export const FILED = suggestion("sg-filed", { revision: 2, state: { kind: "filed", provider: "markdown", path: ".forgerie/backlog/2026-10-21-retry-on-lost-stream.md", at } });
export const FILED_GITHUB = suggestion("sg-filed-github", { destination: github, revision: 2,
  state: { kind: "filed", provider: "github", number: 214, url: "https://github.com/simonwjackson/forgerie/issues/214", at } });
const started = (id: string, sessionId: string, over: Partial<Extract<SuggestionState, { kind: "started" }>> = {}): Suggestion => suggestion(id, { destination: github, revision: 3,
  state: { kind: "started", provider: "github", number: 214, url: "https://github.com/simonwjackson/forgerie/issues/214", at, sessionId, claimId: `c-${sessionId}`,
    modelSpec: "anthropic/claude-haiku-4-5", ...over } });
export const STARTED = started("sg-started", "s-bg-working");
export const STARTED_NEEDS = started("sg-needs", "s-bg-needs", { number: 215, url: "https://github.com/simonwjackson/forgerie/issues/215" });
export const STARTED_DONE = started("sg-done", "s-bg-done", { number: 216, url: "https://github.com/simonwjackson/forgerie/issues/216", modelSpec: "google/gemini-3-8-flash" });
/** Filed to a Markdown file and started: the path opens on a press, right above the session's row. */
export const STARTED_MARKDOWN = suggestion("sg-started-md", { revision: 3, state: { kind: "started", provider: "markdown",
  path: ".forgerie/backlog/2026-10-21-retry-on-lost-stream.md", at, sessionId: "s-bg-working", claimId: "c-md", modelSpec: "anthropic/claude-haiku-4-5" } });
/** Filed to a Markdown file, then the launch failed: the path opens on a press, right above the failure and Start session. */
export const LAUNCH_ERROR_MARKDOWN = suggestion("sg-launch-md", { revision: 3, state: { kind: "filed", provider: "markdown",
  path: ".forgerie/backlog/2026-10-21-retry-on-lost-stream.md", at, launchChoice: { modelSpec: "anthropic/claude-haiku-4-5" },
  launchError: { message: "The session worktree could not be created.", retryable: true } } });
export const LAUNCH_ERROR = suggestion("sg-launch-error", { destination: github, revision: 3,
  state: { kind: "filed", provider: "github", number: 217, url: "https://github.com/simonwjackson/forgerie/issues/217", at,
    launchChoice: { modelSpec: "google/gemini-3-8-flash", thinkingLevel: "low" },
    launchError: { message: "The worktree for the new session could not be created: the disk is full.", retryable: true } } });
export const LAUNCH_ERROR_LOGGED = suggestion("sg-launch-log", { destination: github, revision: 3,
  state: { kind: "filed", provider: "github", number: 218, url: "https://github.com/simonwjackson/forgerie/issues/218", at,
    launchError: { message: "The provider refused the key.", retryable: false },
    decisionLogWarning: "This chat is archived, so its history does not record that the item was filed." } });
export const DUPLICATE = suggestion("sg-duplicate", { destination: github, revision: 2, state: { kind: "duplicate", matches: [
  { number: 198, title: "Retry the reply after the provider drops the stream", state: "open", url: "https://github.com/simonwjackson/forgerie/issues/198" },
  { number: 143, title: "Stream relay leaves tool rows running", state: "closed", url: "https://github.com/simonwjackson/forgerie/issues/143" },
] } });
/** A Markdown backlog already holds close items: File anyway names their paths. */
export const MARKDOWN_DUPLICATE = suggestion("sg-md-duplicate", { revision: 2, state: { kind: "duplicate", matches: [
  { path: ".forgerie/backlog/2026-10-02-retry-dropped-stream.md", title: "Retry a dropped stream once", state: "open" },
  { path: ".forgerie/backlog/2026-09-12-relay-tool-rows.md", title: "Stream relay leaves tool rows running", state: "done" },
] } });
export const FAILED = suggestion("sg-failed", { destination: github, revision: 2,
  state: { kind: "failed", message: "GitHub did not answer (502 Bad Gateway). Nothing was filed.", retryable: true, action: "file" } });
/** File and act failed before anything was filed: Retry files and starts the session again. */
export const FAILED_ACT = suggestion("sg-failed-act", { destination: github, revision: 2,
  state: { kind: "failed", message: "GitHub did not answer (502 Bad Gateway). Nothing was filed, and no session started.", retryable: true, action: "file-and-act" } });
export const FAILED_FINAL = suggestion("sg-failed-final", { destination: github, revision: 2,
  state: { kind: "failed", message: "GitHub refused the issue: the repository is archived.", retryable: false } });
export const AZURE = suggestion("sg-azure", { azureReadOnlyNote: true });
export const DISMISSED = suggestion("sg-dismissed", { title: "Rename streamRelay to providerStream", revision: 2, state: { kind: "dismissed", at } });
/** Dismissed after a GitHub failure the server will not retry: Restore returns it to that failure. */
export const DISMISSED_UNSAFE = suggestion("sg-dismissed-unsafe", { destination: github, revision: 3, state: { kind: "dismissed", at,
  restoreTo: { kind: "failed", message: "GitHub may have created the issue before the connection dropped. Check the repository before filing again.", retryable: false, action: "file" } } });
export const LONG = suggestion("sg-long", {
  title: "Stop the session picker from listing a removed worktree's sessions, and make an empty transcript offer a way back that does not need a reload of the whole app",
  body: "Opening one of them shows an empty transcript. The component that draws it is ui/src/ui/backlog/very/deep/folder/structure/BacklogSuggestionCardWithAVeryLongComponentNameThatNeverBreaks.tsx, and nothing in it handles a missing folder.",
  destination: markdown("stop-the-session-picker-from-listing-a-removed-worktrees-sessions-and-make-an-empty-transcript-offer-a-way-back"),
  context: { why: "Found while landing the worktree in this chat.", decisions: [], files: ["ui/src/ui/Picker.tsx", "ui/src/ui/Picker.test.tsx", "ui/src/sessionRegistry.ts",
    "ui/src/sessionRegistry.test.ts", "ui/src/worktrees/worktreeModel.ts", "ui/src/worktrees/worktreeModel.test.ts", "src/server/worktrees/remove.ts",
    "src/server/worktrees/remove.test.ts", "src/server/sessions/catalog.ts", "src/server/sessions/catalog.test.ts", "docs/session-worktrees.md", "ui/verification/session-worktrees.md"] },
});
export const SHORT = suggestion("sg-short", { title: "Fix typo", body: "", context: { why: "", files: [], decisions: [] } });

/** One chat's records as the list route returns them, newest first. */
export const CHAT_SUGGESTIONS: Suggestion[] = [
  suggestion("sg-e", { title: "Count early stream closes per provider in the usage report", revision: 2, createdAt: "2026-10-21T16:57:00Z",
    state: { kind: "filed", provider: "markdown", path: ".forgerie/backlog/2026-10-21-count-early-closes.md", at: "2026-10-21T16:58:00Z" } }),
  suggestion("sg-d", { title: "Rename streamRelay to providerStream", revision: 2, createdAt: "2026-10-21T16:56:00Z", state: { kind: "dismissed", at } }),
  suggestion("sg-c", { title: "Add a shared fixture that drops the stream after the first tool call", createdAt: "2026-10-21T16:52:00Z",
    destination: markdown("early-close-fixture") }),
  suggestion("sg-b", { title: "Show the provider's close reason under a cut-off reply", createdAt: "2026-10-21T16:51:00Z", destination: markdown("show-stream-close-reason") }),
  { ...STARTED, id: "sg-a", createdAt: "2026-10-21T16:44:00Z" },
];

/** The session list's rows for the background sessions. */
export const LOOKS: Record<string, SessionLook> = {
  "s-bg-working": { state: "working", name: "Retry once when the provider stream drops", time: "3m" },
  "s-bg-needs": { state: "blocked", name: "Show the provider's close reason", time: "1m" },
  "s-bg-done": { state: "open", name: "Add a shared early-close fixture", time: "18m" },
};
export const look = (id: string) => LOOKS[id];
