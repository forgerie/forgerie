import type { SessionResponse } from "../../shared/sessionResponse.js";
import { SESSION_RESPONSE_CUSTOM_TYPE } from "./sessionResponse.js";

/** A catalog cache write cannot fail an already committed conversation event. */
export function writeResponseCheckpoint(
  append: (customType: string, data: unknown) => void,
  response: SessionResponse,
  reportFailure: (error: unknown) => void,
): void {
  try {
    append(SESSION_RESPONSE_CUSTOM_TYPE, { version: 1, kind: "checkpoint", response });
  } catch (error) {
    reportFailure(error);
  }
}
