export type SpeechComponentStatus = "warming" | "ready" | "unavailable";
export type SpeechErrorKind = "unavailable" | "timeout" | "aborted" | "overloaded" | "closed" | "failed" | "empty" | "too_short";

/** A speech failure the routes translate to an HTTP error. The message stays on the server. */
export class SpeechError extends Error {
  public constructor(public readonly kind: SpeechErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SpeechError";
  }
}

export interface SpeechOperationOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
