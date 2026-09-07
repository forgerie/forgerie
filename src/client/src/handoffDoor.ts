import type { ChatGroup, ChatTurn } from "./chatGroups";
import type { ToolExecutionPart } from "./components/shared";

/**
 * The session a turn created, and the way into it.
 *
 * A `/handoff` turn ends in a terminating tool call and says nothing after it,
 * so the transcript's only honest reply is a door. Session *state* is not part
 * of this: the inbox owns whether the destination is preparing, working, or
 * blocked on you, and repeating that here would give a reader two places to
 * read one fact.
 */
export interface HandoffDoor {
  readonly sessionId: string;
  /** Working directory of the destination, used to find the workspace that owns it. */
  readonly cwd: string;
}

/**
 * Tools that create a session, and the field each one names it with.
 *
 * Both report the same two facts on a successful result; only the key differs.
 * A tool that creates nothing never appears here, which is what keeps the door
 * off an ordinary `/skill args` turn.
 */
const SESSION_CREATING_TOOLS: ReadonlyMap<string, string> = new Map([
  ["handoff_session", "destinationSessionId"],
  ["spawn_session", "sessionId"],
]);

/**
 * The door a turn earned, if any.
 *
 * Only a *successful* execution counts. A failed handoff made no session, so
 * it has no door and the transcript says why instead. A running one has no
 * result yet, so there is nothing to open.
 */
export function handoffDoor(turn: ChatTurn): HandoffDoor | undefined {
  for (const execution of toolExecutions(turn.groups)) {
    if (execution.status !== "success") continue;
    const idKey = SESSION_CREATING_TOOLS.get(execution.toolName);
    if (idKey === undefined) continue;
    const sessionId = stringAt(execution.details, idKey);
    const cwd = stringAt(execution.details, "cwd");
    if (sessionId === undefined || cwd === undefined) continue;
    return { sessionId, cwd };
  }
  return undefined;
}

function toolExecutions(groups: readonly ChatGroup[]): ToolExecutionPart[] {
  const executions: ToolExecutionPart[] = [];
  for (const group of groups) {
    const messages = group.kind === "group" ? group.messages : [group.message];
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type === "toolExecution") executions.push(part);
      }
    }
  }
  return executions;
}

function stringAt(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const found: unknown = Reflect.get(value, key);
  return typeof found === "string" && found !== "" ? found : undefined;
}
