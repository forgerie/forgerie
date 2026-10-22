// What the server does to a record on each press, for scenarios: the same transitions the routes make, held in
// memory. File and act from a filed record only starts the session. No clock: times are the fixtures' own.
import type { Suggestion } from "../suggestionsApi";
import type { SuggestionAction } from "../suggestionsModel";

const AT = "2026-10-21T16:58:00Z";
/** The session a scenario's File and act starts. */
export const STARTED_SESSION = "s-bg-working";

export function answer(record: Suggestion, press: SuggestionAction | "dismiss" | "restore", request: { modelSpec?: string | undefined; title?: string | undefined; body?: string | undefined } = {}): Suggestion {
  const next = { ...record, revision: record.revision + 1, ...(request.title ? { title: request.title } : {}), ...(request.body !== undefined && request.title ? { body: request.body } : {}) };
  const where = record.destination.provider === "github"
    ? { provider: "github", number: 219, url: "https://github.com/simonwjackson/forgerie/issues/219" }
    : { provider: "markdown", path: record.destination.path };
  const filed = record.state.kind === "filed" ? record.state : undefined;
  const filedAt = filed ? { provider: filed.provider, path: filed.path, number: filed.number, url: filed.url, at: filed.at } : { ...where, at: AT };
  switch (press) {
    case "file": return { ...next, state: { kind: "filed", ...where, at: AT } };
    case "file-and-act": return { ...next, state: { ...filedAt, kind: "started", sessionId: STARTED_SESSION, claimId: "c-started",
      modelSpec: request.modelSpec ?? record.defaultModel.modelSpec } };
    case "dismiss": return { ...next, state: { kind: "dismissed", at: AT } };
    case "restore": return { ...next, state: { kind: "open" } };
  }
}
