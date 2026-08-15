/**
 * Hide a delegated fork for the span where no durable mark can exist yet.
 *
 * A forked subagent run creates its child session the moment it dispatches,
 * but the run only reports which file it made when it finishes. Between those
 * two points the child is a session with no mark, and the inbox shows it as a
 * row of its own -- a copy of the parent's whole transcript, wearing the
 * parent's title. On a long run that row sits there for many minutes.
 *
 * The link used here is `parentSession`, which on its own means "continues
 * from" and not "was made by". It is not evidence of delegation and must never
 * be treated as such: reading it as ownership is what collapsed real
 * conversations under unrelated rows in 245e7ff. What makes it usable here is
 * the second half of the pair -- the daemon is watching that exact parent run a
 * delegating tool at this moment. The claim is narrow and it expires: the
 * moment the run ends, this stops applying and the durable header mark, written
 * from the run's own report, takes over.
 *
 * So this hides nothing permanently and writes nothing to disk. A session it
 * hides in error reappears within seconds of the run ending.
 */

export interface PossiblySpawnedSession {
  readonly parentSessionPath?: string | undefined;
  readonly agentSpawned?: boolean | undefined;
}

export function hideChildrenOfDelegatingSessions<Session extends PossiblySpawnedSession>(
  sessions: readonly Session[],
  delegatingSessionFiles: ReadonlySet<string>,
): Session[] {
  if (delegatingSessionFiles.size === 0) return [...sessions];
  return sessions.map((session) => {
    if (session.agentSpawned === true) return session;
    const parent = session.parentSessionPath;
    if (parent === undefined || !delegatingSessionFiles.has(parent)) return session;
    return { ...session, agentSpawned: true };
  });
}
