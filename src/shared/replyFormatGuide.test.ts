import { describe, expect, it } from "vitest";
import { REPLY_FORMAT_GUIDE, withReplyFormatGuide } from "./replyFormatGuide.js";

describe("reply format guide", () => {
  it("adds the guide after the profile's own sections, once", () => {
    const once = withReplyFormatGuide(["profile section"]);
    expect(once).toEqual(["profile section", REPLY_FORMAT_GUIDE]);
    expect(withReplyFormatGuide(once)).toEqual(once);
  });

  it("shows an example of every block the browser app renders", () => {
    expect(REPLY_FORMAT_GUIDE).toContain("> [!WARNING]\n> ");
    for (const language of ["steps", "compare", "status", "files", "facts", "diagram", "claims", "commands", "details", "bars"]) {
      expect(REPLY_FORMAT_GUIDE).toContain("```" + language + "\n");
    }
  });
});
