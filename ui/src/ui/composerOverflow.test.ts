import { describe, expect, it } from "vitest";
import { barGap, inlineSlots, neededWidth, planBar, samePlan, type BarSlot, type BarWidths } from "./composerOverflow";

// Natural widths measured from the mockup's controls at 15px type.
const widths: BarWidths = { attach: 28, handleWords: 132, handleTotal: 44, model: 150, dictate: 28, more: 28, steer: 58, send: 64, context: 28 };
const idle = new Set<BarSlot>(["attach", "handle", "model", "dictate", "send"]);
const running = new Set<BarSlot>(["attach", "handle", "model", "dictate", "steer", "send"]);
const BAR = 600; // gap 16

/** The room a step needs exactly, so a test can stand one pixel either side of it. */
const need = (present: ReadonlySet<BarSlot>, handle: "words" | "total", overflow: readonly ("model" | "steer" | "attach" | "dictate")[]) =>
  neededWidth({ handle, overflow }, barGap(BAR), widths, present);
const plan = (room: number, present: ReadonlySet<BarSlot> = running, extra: Partial<Parameters<typeof planBar>[0]> = {}) =>
  planBar({ room, barWidth: BAR, widths, present, ...extra });

describe("the gap", () => {
  it("is 4% of the bar, between 8 and 16 px", () => {
    expect([barGap(0), barGap(212), barGap(213), barGap(387), barGap(388), barGap(2000)]).toEqual([8, 8, 9, 15, 16, 16]);
  });
  it("is the plan's gap, so plan and drawing agree", () => {
    expect(planBar({ room: 1000, barWidth: 300, widths, present: idle }).gap).toBe(12);
  });
});

describe("the ladder, first fit wins", () => {
  const ladder: [string, "words" | "total", ("model" | "steer" | "attach" | "dictate")[]][] = [
    ["everything inline, the handle in words", "words", []],
    ["the handle as its total", "total", []],
    ["the model picker in More", "total", ["model"]],
    ["then Steer", "total", ["model", "steer"]],
    ["then Attach", "total", ["model", "steer", "attach"]],
    ["then Dictate", "total", ["model", "steer", "attach", "dictate"]],
  ];
  ladder.forEach(([name, handle, overflow], index) => {
    it(`${name}: fits at its width and one px over, and gives way one px under`, () => {
      const exact = need(running, handle, overflow);
      const ordered = (slots: readonly string[]) => ["attach", "model", "dictate", "steer"].filter((slot) => slots.includes(slot));
      for (const room of [exact, exact + 1]) expect(plan(room)).toEqual({ gap: 16, handle, overflow: ordered(overflow) });
      const next = ladder[index + 1];
      if (next) expect(plan(exact - 1)).toEqual({ gap: 16, handle: next[1], overflow: ordered(next[2]) });
    });
  });

  it("keeps the last step when nothing fits: the primary actions stay on the row", () => {
    expect(plan(10)).toEqual({ gap: 16, handle: "total", overflow: ["attach", "model", "dictate", "steer"] });
  });

  it("moves the model picker before Steer, Steer before Attach, Attach before Dictate", () => {
    const steps = [need(running, "total", []) - 1, need(running, "total", ["model"]) - 1, need(running, "total", ["model", "steer"]) - 1,
      need(running, "total", ["model", "steer", "attach"]) - 1].map((room) => plan(room).overflow);
    expect(steps).toEqual([["model"], ["model", "steer"], ["attach", "model", "steer"], ["attach", "model", "dictate", "steer"]]);
  });
});

describe("the order rules", () => {
  it("never moves the handle or the sends", () => {
    for (const room of [0, 100, 200, 300, 400, 600]) {
      const shown = inlineSlots(plan(room), running);
      expect(shown).toContain("handle");
      expect(shown).toContain("send");
    }
  });

  it("draws More only when it holds something, at the end of the left group, so the sends keep the corner", () => {
    expect(inlineSlots(plan(2000), running)).toEqual(["attach", "handle", "model", "dictate", "steer", "send"]);
    expect(inlineSlots(plan(need(running, "total", ["model"])), running)).toEqual(["attach", "handle", "dictate", "more", "steer", "send"]);
  });

  it("skips the handle's step when the ledge holds nothing", () => {
    const bare = new Set<BarSlot>(["attach", "model", "dictate", "send"]);
    const exact = neededWidth({ handle: "words", overflow: [] }, 16, widths, bare);
    expect(planBar({ room: exact, barWidth: BAR, widths, present: bare })).toEqual({ gap: 16, handle: "words", overflow: [] });
    expect(planBar({ room: exact - 1, barWidth: BAR, widths, present: bare }).overflow).toEqual(["model"]);
  });

  it("moves only controls the row holds: idle, Steer is not there to move", () => {
    expect(plan(need(idle, "total", ["model"]) - 1, idle).overflow).toEqual(["attach", "model"]);
  });

  it("keeps a pinned control inline, such as dictation while it listens", () => {
    expect(plan(10, running, { pinned: new Set(["dictate"]) }).overflow).toEqual(["attach", "model", "steer"]);
  });

  it("counts the readout at its least width: it shrinks before any control moves", () => {
    const withContext = new Set<BarSlot>([...idle, "context"]);
    const exact = neededWidth({ handle: "words", overflow: [] }, 16, widths, withContext);
    expect(exact).toBe(need(idle, "words", []) + 28 + 16);
    expect(planBar({ room: exact, barWidth: BAR, widths, present: withContext }).overflow).toEqual([]);
  });

  it("says when two plans draw the same row", () => {
    expect(samePlan(plan(2000), plan(3000))).toBe(true);
    expect(samePlan(plan(2000), plan(10))).toBe(false);
  });
});
