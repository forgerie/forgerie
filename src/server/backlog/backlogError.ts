import type { BacklogClaim, BacklogErrorResponse } from "../../shared/apiTypes.js";

export class BacklogError extends Error {
  constructor(readonly kind: BacklogErrorResponse["kind"], message: string, readonly claim?: BacklogClaim) { super(message); }
}
export function isMissingFile(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
export function backlogErrorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
