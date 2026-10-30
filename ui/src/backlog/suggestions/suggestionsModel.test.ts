// What File and act here asks this chat's agent to do.
import { describe, expect, it } from "vitest";
import { FILED, FILED_GITHUB, OPEN, STARTED } from "./fixtures/suggestions";
import { hereMessage } from "./suggestionsModel";

describe("the message File and act here sends", () => {
  it("names one filed item by its issue number and link", () => {
    expect(hereMessage([FILED_GITHUB])).toBe(`Work on the backlog item I just filed: #214 (https://github.com/simonwjackson/forgerie/issues/214): ${FILED_GITHUB.title}`);
  });

  it("numbers several in the order given, a Markdown item by its file, and leaves out what is not filed", () => {
    const second = { ...FILED, title: "  Give the dock a height budget " };
    expect(hereMessage([STARTED, OPEN, second])).toBe([
      "Work on the 2 backlog items I just filed, one at a time, in this order:",
      `1. #214 (https://github.com/simonwjackson/forgerie/issues/214): ${STARTED.title}`,
      "2. `.forgerie/backlog/2026-10-21-retry-on-lost-stream.md`: Give the dock a height budget",
    ].join("\n"));
  });

  it("is nothing when nothing is filed", () => {
    expect(hereMessage([])).toBeUndefined();
    expect(hereMessage([OPEN])).toBeUndefined();
  });
});
