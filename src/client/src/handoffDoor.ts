import type { ChatGroup, ChatTurn } from "./chatGroups";
import type { ChatLine, ToolExecutionPart } from "./components/shared";

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
 * A turn's door, and the step that earned it.
 *
 * The two travel together because promoting a step out of the rail and drawing
 * the door are one decision. Splitting them let the transcript count a step it
 * had already rendered as something else.
 */
export interface TurnHandoff {
  readonly door: HandoffDoor;
  readonly execution: ToolExecutionPart;
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
export function turnHandoff(turn: ChatTurn): TurnHandoff | undefined {
  for (const execution of toolExecutions(turn.groups)) {
    if (execution.status !== "success") continue;
    const idKey = SESSION_CREATING_TOOLS.get(execution.toolName);
    if (idKey === undefined) continue;
    const sessionId = stringAt(execution.details, idKey);
    const cwd = stringAt(execution.details, "cwd");
    if (sessionId === undefined || cwd === undefined) continue;
    return { door: { sessionId, cwd }, execution };
  }
  return undefined;
}

/**
 * The rail's groups with the promoted step removed.
 *
 * A step the transcript already renders as its own thing is not work to
 * report: the door says a session was made and opens it, so counting the same
 * call again on the rail asks the reader to hold one fact in two places. The
 * turn's image gallery does this already -- `withoutToolImageGroups` -- and
 * this is the same move for the same reason.
 *
 * Only what the door took is dropped. Other steps in the turn keep their
 * count, and a failed call is never promoted, so it stays on the rail where
 * the receipt reports it as unresolved.
 *
 * What leaves with it is the tool's own result text, whose only fact not
 * already on screen is the handoff id. That id names the destination's
 * preparation prompt and its handoff document, both of which are the first
 * thing inside the door.
 */
export function withoutPromotedStep(groups: readonly ChatGroup[], promoted: TurnHandoff | undefined): ChatGroup[] {
  if (promoted === undefined) return [...groups];
  const kept: ChatGroup[] = [];
  for (const group of groups) {
    if (group.kind !== "group") {
      if (!holdsExecution(group.message, promoted.execution)) kept.push(group);
      continue;
    }
    const messages = group.messages.filter((message) => !holdsExecution(message, promoted.execution));
    if (messages.length === group.messages.length) kept.push(group);
    else if (messages.length > 0) kept.push({ ...group, messages });
  }
  return kept;
}

/** Identity is the part itself: two calls of one tool in a turn are two steps. */
function holdsExecution(message: ChatLine, execution: ToolExecutionPart): boolean {
  return message.parts.length === 1 && message.parts[0] === execution;
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
