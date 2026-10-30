import { resolve, sep } from "node:path";

export const EPHEMERAL_SESSIONS_DIRECTORY = "ephemeral-sessions";

/** The storage location is the persisted lifetime marker, including journal receipts. */
export function isEphemeralSessionPath(path: string | undefined): boolean {
  return path !== undefined && resolve(path).split(sep).includes(EPHEMERAL_SESSIONS_DIRECTORY);
}
