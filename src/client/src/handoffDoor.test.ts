import { describe, expect, it } from "vitest";
import { chatTurns, groupChatMessages } from "./chatGroups";
import { turnHandoff, withoutPromotedStep } from "./handoffDoor";
import type { ChatLine, ToolExecutionPart } from "./components/shared";

const command: ChatLine = {
  role: "user",
  parts: [{ type: "skillInvocation", name: "handoff", location: "/skills/handoff/SKILL.md", content: "Call handoff_session.", argument: "slow first full-library startup" }],
};

function ran(execution: Partial<ToolExecutionPart> & { toolName: string; status: ToolExecutionPart["status"] }): ChatLine {
  return { role: "tool", parts: [{ type: "toolExecution", summary: "", ...execution }] };
}

function turnOf(...messages: ChatLine[]) {
  const turn = chatTurns(groupChatMessages(messages))[0];
  if (turn === undefined) throw new Error("Expected one turn");
  return turn;
}

describe("the door a turn earned", () => {
  it("names the session a handoff created, and where it lives", () => {
    const turn = turnOf(command, ran({
      toolName: "handoff_session",
      status: "success",
      details: { handoffId: "d272ec25", destinationSessionId: "01a07c5b", cwd: "/home/me/code/pyxis", state: "preparing" },
    }));

    expect(turnHandoff(turn)?.door).toEqual({ sessionId: "01a07c5b", cwd: "/home/me/code/pyxis" });
  });

  it("takes the same door from a spawned session, which names its id differently", () => {
    const turn = turnOf(command, ran({
      toolName: "spawn_session",
      status: "success",
      details: { sessionId: "01a07999", cwd: "/home/me/code/pyxis" },
    }));

    expect(turnHandoff(turn)?.door).toEqual({ sessionId: "01a07999", cwd: "/home/me/code/pyxis" });
  });

  it("opens no door for a handoff that failed, because it made no session", () => {
    const turn = turnOf(command, ran({
      toolName: "handoff_session",
      status: "error",
      resultText: "Spawning sessions is disabled",
    }));

    expect(turnHandoff(turn)).toBeUndefined();
  });

  it("opens no door while the call is still running, because there is nothing to open yet", () => {
    const turn = turnOf(command, ran({ toolName: "handoff_session", status: "running" }));

    expect(turnHandoff(turn)).toBeUndefined();
  });

  it("opens no door for a skill that created nothing", () => {
    const turn = turnOf(
      { role: "user", parts: [{ type: "skillInvocation", name: "se-work", location: "/skills/se-work/SKILL.md", content: "Execute work." }] },
      ran({ toolName: "edit", status: "success", details: { cwd: "/home/me/code/pyxis" } }),
    );

    expect(turnHandoff(turn)).toBeUndefined();
  });

  it("opens no door when the result names a session but no workspace to find it in", () => {
    const turn = turnOf(command, ran({
      toolName: "handoff_session",
      status: "success",
      details: { destinationSessionId: "01a07c5b" },
    }));

    expect(turnHandoff(turn)).toBeUndefined();
  });
});

describe("the step a door promoted", () => {
  const success = {
    toolName: "handoff_session",
    status: "success" as const,
    details: { destinationSessionId: "01a07c5b", cwd: "/home/me/code/pyxis" },
  };

  it("leaves the rail, so one call is not both a door and a step", () => {
    const turn = turnOf(command, ran(success));

    expect(withoutPromotedStep(turn.groups, turnHandoff(turn))).toEqual([turn.groups[0]]);
  });

  it("keeps every other step the turn ran", () => {
    const turn = turnOf(
      command,
      ran({ toolName: "read", status: "success", details: { path: "docs/plan.md" } }),
      ran(success),
    );

    const kept = withoutPromotedStep(turn.groups, turnHandoff(turn));
    const executions = kept.flatMap((group) => group.kind === "group"
      ? group.messages.flatMap((message) => message.parts.filter((part) => part.type === "toolExecution"))
      : []);
    expect(executions.map((execution) => execution.toolName)).toEqual(["read"]);
  });

  it("keeps a failed call on the rail, which is the only place that reports it", () => {
    const turn = turnOf(command, ran({ toolName: "handoff_session", status: "error", resultText: "Spawning sessions is disabled" }));

    expect(withoutPromotedStep(turn.groups, turnHandoff(turn))).toEqual(turn.groups);
  });

  it("drops nothing when the turn earned no door", () => {
    const turn = turnOf(command, ran({ toolName: "edit", status: "success" }));

    expect(withoutPromotedStep(turn.groups, undefined)).toEqual(turn.groups);
  });
});
