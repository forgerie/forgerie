import { describe, expect, it } from "vitest";
import { createLocationResolver, rows, type PickerSession, type PickerStatus } from "./board";
import { commandForKey, rowCommands } from "./commands";
import { readRowPress, ROW_PRESS } from "./press";

const idle = { isStreaming: false, isCompacting: false, isBashRunning: false };
const locate = createLocationResolver([], []);
function row(session: Partial<PickerSession>, status?: PickerStatus, activity?: { phase: "active" | "idle" | "error" }) {
  const [only] = rows({
    sessions: [{ id: "s", cwd: "/code/x", modified: "2026-09-29T18:00:00.000Z", ...session }],
    statuses: status ? { s: status } : {}, activities: activity ? { s: activity } : {}, unread: new Set(), locate, now: Date.parse("2026-09-29T18:10:00.000Z"),
  });
  if (!only) throw new Error("no row");
  return only;
}
const kinds = (list: ReturnType<typeof rowCommands>) => list.map((command) => command.kind);

describe("row commands", () => {
  it("offers pin, archive, and copy on an open session", () => {
    expect(kinds(rowCommands(row({})))).toEqual(["pin", "archive", "copyPath"]);
    expect(rowCommands(row({})).find((command) => command.kind === "archive")?.disabled).toBeUndefined();
  });

  it("shows archive disabled with the reason while the session runs, as the server refuses it", () => {
    for (const status of [{ ...idle, isStreaming: true }, { ...idle, isCompacting: true }, { ...idle, isBashRunning: true }, { ...idle, isStreaming: true, blocked: true }]) {
      expect(rowCommands(row({}, status)).find((command) => command.kind === "archive")?.disabled).toBe("Stop the run first");
    }
  });

  it("lets an active phase with no run behind it archive, as the server allows it", () => {
    const working = row({}, idle, { phase: "active" });
    expect(working.state).toBe("working");
    expect(rowCommands(working).find((command) => command.kind === "archive")?.disabled).toBeUndefined();
  });

  it("offers only unpin and copy on a pinned session, as the server refuses to archive a pin", () => {
    expect(kinds(rowCommands(row({ pinned: true })))).toEqual(["unpin", "copyPath"]);
  });

  it("offers restore and a dangerous delete on an archived session", () => {
    const list = rowCommands(row({ archived: true }));
    expect(kinds(list)).toEqual(["restore", "delete", "copyPath"]);
    expect(list.find((command) => command.kind === "delete")?.danger).toBe(true);
  });

  it("runs E only where archive is offered and allowed", () => {
    expect(commandForKey(row({}), "e")?.kind).toBe("archive");
    expect(commandForKey(row({}, { ...idle, isStreaming: true }), "e")).toBeUndefined();
    expect(commandForKey(row({ pinned: true }), "e")).toBeUndefined();
    expect(commandForKey(row({ archived: true }), "e")).toBeUndefined();
  });
});

describe("row press", () => {
  it("reads a hold as commands, a tap as select, and travel as a scroll", () => {
    expect(readRowPress(0, ROW_PRESS.holdMs)).toBe("commands");
    expect(readRowPress(0, ROW_PRESS.holdMs - 1)).toBe("select");
    expect(readRowPress(ROW_PRESS.moveTolerancePx, ROW_PRESS.holdMs)).toBe("commands");
    expect(readRowPress(ROW_PRESS.moveTolerancePx + 1, 10)).toBe("abandoned");
  });
});
