import { z } from "zod";

/**
 * The session a tool call created, and the way into it.
 *
 * A handoff ends its run with the call that made the session, so the call is
 * the only place the transcript can say where the work went. The door holds
 * no destination state on purpose: the picker owns whether that session is
 * preparing, working, or waiting, and repeating it here would give a reader
 * two places to read one fact.
 */
export interface HandoffDoor {
  readonly sessionId: string;
  /** The destination's working directory, which the server needs to open it. */
  readonly cwd: string;
}

// The server's handoff_session and spawn_session results report the same two
// facts in their details. Only the id key differs.
const sessionCreatingTools: ReadonlyMap<string, z.ZodType<HandoffDoor>> = new Map<string, z.ZodType<HandoffDoor>>([
  ["handoff_session", z.object({ destinationSessionId: z.string().min(1), cwd: z.string().min(1) })
    .transform(({ destinationSessionId, cwd }) => ({ sessionId: destinationSessionId, cwd }))],
  ["spawn_session", z.object({ sessionId: z.string().min(1), cwd: z.string().min(1) })
    .transform(({ sessionId, cwd }) => ({ sessionId, cwd }))],
]);

/**
 * The door a finished tool call earned, if any. Only a successful call of a
 * session-creating tool counts: a failed call made no session, so it keeps
 * its place as a failure instead.
 */
export function handoffDoorOf({ toolName, isError, details }: { toolName: string; isError: boolean; details: unknown }): HandoffDoor | undefined {
  const schema = sessionCreatingTools.get(toolName);
  if (isError || !schema) return undefined;
  const parsed = schema.safeParse(details);
  return parsed.success ? parsed.data : undefined;
}

/** A workspace's short name: the last segment of its path. */
export function workspaceName(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd;
}
