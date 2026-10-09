import { describe, expect, it } from "vitest";
import { eventPhrase, exitMeaning, foldProcessEvents, parseProcessEvent, readableDuration } from "./processEvent";
import { failedLongXml, failedXml, matchedXml, stoppedXml, succeededXml } from "./fixtures/processEvents";

describe("process events", () => {
  it("reads a success with its decoded command and duration", () => {
    const event = parseProcessEvent(succeededXml, 5)!;
    expect(event).toMatchObject({ outcome: "succeeded", id: "proc_2482", name: "cpo-poc-build", exitCode: 0, duration: "12s", at: 5,
      command: "cd ~/code/cpo-poc && npm ci && npm run build" });
    expect(eventPhrase(event)).toBe("succeeded in 12s");
  });

  it("reads a crash and explains its exit code", () => {
    const event = parseProcessEvent(failedXml)!;
    expect(event).toMatchObject({ outcome: "failed", exitCode: 127, duration: "0s" });
    expect(eventPhrase(event)).toBe("failed with exit code 127");
    expect(exitMeaning(127)).toBe("The shell could not find the command.");
    expect(exitMeaning(42)).toBeUndefined();
  });

  it("counts a long run in minutes, not seconds", () => {
    expect(parseProcessEvent(failedLongXml)?.duration).toBe("2m 25s");
    expect(readableDuration("59s")).toBe("59s");
    expect(readableDuration("60s")).toBe("1m");
    expect(readableDuration("3661s")).toBe("1h 1m 1s");
    expect(readableDuration("1.5s")).toBe("1.5s");
    expect(readableDuration("2m 5s")).toBe("2m 5s");
  });

  it("reads a kill by signal without mistaking it for a duration", () => {
    const event = parseProcessEvent(stoppedXml)!;
    expect(event).toMatchObject({ outcome: "stopped", signal: "SIGTERM", exitCode: 143 });
    expect(event.duration).toBeUndefined();
    expect(eventPhrase(event)).toBe("stopped (SIGTERM)");
  });

  it("reads a log match with the line that matched", () => {
    expect(parseProcessEvent(matchedXml)).toMatchObject({ outcome: "matched", pattern: "Local:", stream: "stdout",
      matchedLine: "➜  Local:   http://localhost:5173/" });
  });

  it("ignores text that is not a known event", () => {
    expect(parseProcessEvent("plain text")).toBeUndefined();
    expect(parseProcessEvent('<process_event type="lifecycle" kind="paused" process_id="p"></process_event>')).toBeUndefined();
  });

  it("folds a run of matches from one process into the latest, counted", () => {
    const match = (id: string, line: string) => ({ processEvent: { ...parseProcessEvent(matchedXml)!, id, matchedLine: line } });
    const done = { processEvent: parseProcessEvent(succeededXml)! };
    const folded = foldProcessEvents([match("a", "1"), match("a", "2"), match("a", "3"), match("b", "x"), done, match("b", "y")]);
    expect(folded.map((message) => [message.processEvent.id, message.processEvent.repeats, message.processEvent.matchedLine]))
      .toEqual([["a", 3, "3"], ["b", 1, "x"], ["proc_2482", 1, undefined], ["b", 1, "y"]]);
    expect(eventPhrase(folded[0]!.processEvent)).toBe("printed a watched line 3 times");
  });

  it("returns the same array when nothing folds", () => {
    const messages = [{ processEvent: undefined }, { processEvent: parseProcessEvent(succeededXml)! }];
    expect(foldProcessEvents(messages)).toBe(messages);
  });
});
