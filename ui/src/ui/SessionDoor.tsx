import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { workspaceName, type HandoffDoor } from "../handoffDoor";
import { ToolCall } from "./Trace";

/** How a door opens its session, and which workspace is already on screen. */
interface SessionDoors {
  readonly cwd: string | undefined;
  readonly open: (door: HandoffDoor) => void;
}
const SessionDoorsContext = createContext<SessionDoors | undefined>(undefined);

/**
 * Binding seam: the session binding supplies navigation once, so a door deep
 * inside a reply needs no props threaded through assistant-ui's parts.
 */
export function SessionDoorsProvider({ cwd, open, children }: SessionDoors & { children: ReactNode }) {
  const doors = useMemo(() => ({ cwd, open }), [cwd, open]);
  return <SessionDoorsContext.Provider value={doors}>{children}</SessionDoorsContext.Provider>;
}

/**
 * Molecule: a call that created a session. It keeps the ordinary tool line,
 * so its input and output stay one tap away, and adds the way into the
 * session it made. Without a provider there is nowhere to go, so only the
 * line renders.
 */
export function SessionDoorCall({ door, ...call }: { door: HandoffDoor }
  & Pick<ToolCallMessagePartProps, "toolCallId" | "toolName" | "args" | "result" | "isError" | "artifact">) {
  const doors = useContext(SessionDoorsContext);
  // The workspace is named only when it differs: the shell already shows this one.
  const elsewhere = doors && door.cwd !== doors.cwd ? workspaceName(door.cwd) : undefined;
  return <div className="session-door">
    <ToolCall {...call} />
    {doors && <button type="button" className="session-door-open"
      title={elsewhere ? `Open the created session in ${door.cwd}` : "Open the created session"}
      onClick={() => doors.open(door)}>
      <span>{elsewhere ? `Open in ${elsewhere}` : "Open session"}</span>
    </button>}
  </div>;
}
