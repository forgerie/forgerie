import { SessionAsks, type SessionAsksOptions } from "./sessionAsks.js";
import { responseFromBranch, SESSION_RESPONSE_CUSTOM_TYPE } from "./sessionResponse.js";

/** In-memory transcript port. Rebuilding SessionAsks over these entries preserves every open ask. */
export function transcriptAsks(options: Partial<Pick<SessionAsksOptions, "now" | "createAskId">> = {}) {
  const branches = new Map<string, unknown[]>();
  return new SessionAsks({
    ...options,
    readResponse: (id) => responseFromBranch(branches.get(id) ?? []),
    appendEvent: (id, data) => {
      branches.set(id, [...(branches.get(id) ?? []), { type: "custom", customType: SESSION_RESPONSE_CUSTOM_TYPE, data }]);
    },
  });
}
