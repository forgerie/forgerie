import type { SessionRef, SessionStatus } from "../../shared/apiTypes.js";
import type { DurableBrowserMessage } from "../../shared/durableBrowserSnapshot.js";
import type { SessionHistoryPage, SessionOpenRequest, SessionOpenResponse } from "../../shared/sessionOpen.js";

/** Classic saved shell rows can disclose their full output; native rows use the same allowlist. */
export type SessionOpenMessage = DurableBrowserMessage & { fullOutputPath?: string };
export type SessionOpenResult = SessionOpenResponse<SessionOpenMessage, SessionStatus>;
export type SessionOpenHistoryPage = SessionHistoryPage<SessionOpenMessage>;

/** Acquisition contract only. Implementations must return one detached consistent cut. */
export interface SessionOpenReader {
  open(ref: SessionRef, page: Pick<SessionOpenRequest, "limit" | "around">): Promise<SessionOpenResult>;
}
