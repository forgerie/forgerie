import { randomUUID, createHash } from "node:crypto";
import type { SessionRef, SessionStatus } from "../../shared/apiTypes.js";
import type { DurableBrowserMessage } from "../../shared/durableBrowserSnapshot.js";
import type { SessionHistoryPage, SessionOpenRequest, SessionOpenResponse } from "../../shared/sessionOpen.js";

/** Classic saved shell rows can disclose their full output; native rows use the same allowlist. */
export type SessionOpenMessage = DurableBrowserMessage & { fullOutputPath?: string | undefined };
export type SessionOpenResult = SessionOpenResponse<SessionOpenMessage, SessionStatus>;
export type SessionOpenHistoryPage = SessionHistoryPage<SessionOpenMessage>;

/** Implementations return one detached consistent cut. */
export interface SessionOpenReader {
  open(ref: SessionRef, page: Pick<SessionOpenRequest, "limit" | "around">): Promise<SessionOpenResult>;
}

/** Only fingerprints are retained. Transcript data keeps its existing storage owner. */
export class PresentationHistoryIdentity {
  private readonly histories = new Map<string, { id: string; fingerprints: string[] }>();
  identify(key: string, messages: readonly SessionOpenMessage[]): string {
    const fingerprints = messages.map(message => createHash("sha256").update(JSON.stringify(message)).digest("base64url"));
    const previous = this.histories.get(key);
    const appended = previous !== undefined && previous.fingerprints.length <= fingerprints.length
      && previous.fingerprints.every((fingerprint, index) => fingerprint === fingerprints[index]);
    const id = appended ? previous.id : `classic:v1:${randomUUID()}`;
    this.histories.set(key, { id, fingerprints });
    return id;
  }
}

export class SessionOpenError extends Error {
  constructor(message: string, readonly status: 404 | 409 | 503, readonly code: string) { super(message); }
}
