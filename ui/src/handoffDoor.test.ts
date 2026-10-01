import { describe, expect, it } from "vitest";
import { handoffDoorOf, workspaceName } from "./handoffDoor";

// Result details as the server's handoff_session and spawn_session tools report them.
const handedOff = { handoffId: "h1", sourceSessionId: "source", destinationSessionId: "destination",
  cwd: "/work/forgerie", model: "provider/model", state: "preparing" };
const spawned = { sessionId: "spawned", cwd: "/work/other", model: "provider/model" };

describe("handoff doors", () => {
  it("names the session a handoff created, and where it lives", () => {
    expect(handoffDoorOf({ toolName: "handoff_session", isError: false, details: handedOff }))
      .toEqual({ sessionId: "destination", cwd: "/work/forgerie" });
  });

  it("takes the same door from a spawned session, which names its id differently", () => {
    expect(handoffDoorOf({ toolName: "spawn_session", isError: false, details: spawned }))
      .toEqual({ sessionId: "spawned", cwd: "/work/other" });
  });

  it("opens no door for a call that failed, because it made no session", () => {
    expect(handoffDoorOf({ toolName: "handoff_session", isError: true, details: handedOff })).toBeUndefined();
  });

  it("opens no door for a tool that creates nothing, even when its details look alike", () => {
    expect(handoffDoorOf({ toolName: "subagent", isError: false, details: spawned })).toBeUndefined();
  });

  it("opens no door when the result does not name both the session and its workspace", () => {
    expect(handoffDoorOf({ toolName: "handoff_session", isError: false, details: { destinationSessionId: "d" } })).toBeUndefined();
    expect(handoffDoorOf({ toolName: "spawn_session", isError: false, details: { sessionId: "", cwd: "/w" } })).toBeUndefined();
    expect(handoffDoorOf({ toolName: "spawn_session", isError: false, details: undefined })).toBeUndefined();
    expect(handoffDoorOf({ toolName: "spawn_session", isError: false, details: "spawned" })).toBeUndefined();
  });
});

describe("workspace names", () => {
  it("names a workspace by its last path segment", () => {
    expect(workspaceName("/home/me/code/forgerie")).toBe("forgerie");
    expect(workspaceName("/home/me/code/forgerie/")).toBe("forgerie");
    expect(workspaceName("C:\\code\\forgerie")).toBe("forgerie");
    expect(workspaceName("/")).toBe("/");
  });
});
