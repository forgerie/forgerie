import { describe, expect, it } from "vitest";
import { REPLY_FORMAT_GUIDE, withReplyFormatGuide } from "./replyFormatGuide.js";

describe("reply format guide", () => {
  it("adds the guide after the profile's own sections, once", () => {
    const once = withReplyFormatGuide(["profile section"]);
    expect(once).toEqual(["profile section", REPLY_FORMAT_GUIDE]);
    expect(withReplyFormatGuide(once)).toEqual(once);
  });

  it("stays within its budget, because every model call carries it", () => {
    // About 750 tokens. Raise this only with the per-call cost in mind.
    expect(REPLY_FORMAT_GUIDE.length).toBeLessThanOrEqual(3_000);
  });

  it("explicitly treats proposal text as a browser document, not a repository file", () => {
    expect(REPLY_FORMAT_GUIDE).toContain("### Workflow proposals");
    expect(REPLY_FORMAT_GUIDE).toContain("propose_workflow.text");
    expect(REPLY_FORMAT_GUIDE).toContain("use these blocks there too");
  });

  it("shows an example of every block the browser app renders", () => {
    expect(REPLY_FORMAT_GUIDE).toContain("> [!NOTE]");
    for (const language of ["steps", "compare", "status", "files", "facts", "diagram", "claims", "commands", "details", "bars", "correction", "asides", "timeline"]) {
      expect(REPLY_FORMAT_GUIDE).toContain("```" + language + "\n");
    }
  });
});
