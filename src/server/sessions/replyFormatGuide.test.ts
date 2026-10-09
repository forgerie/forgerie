import { describe, expect, it } from "vitest";
import { REPLY_FORMAT_GUIDE, withReplyFormatGuide } from "./replyFormatGuide.js";

describe("reply format guide", () => {
  it("adds the guide after the profile's own sections, once", () => {
    const once = withReplyFormatGuide(["profile section"]);
    expect(once).toEqual(["profile section", REPLY_FORMAT_GUIDE]);
    expect(withReplyFormatGuide(once)).toEqual(once);
  });

  it("shows each block in the syntax the browser app parses", () => {
    expect(REPLY_FORMAT_GUIDE).toContain("> [!WARNING]\n> ");
    expect(REPLY_FORMAT_GUIDE).toMatch(/```steps\n1\. .+\n {3}\S/);
    expect(REPLY_FORMAT_GUIDE).toMatch(/```compare\n## .+ \(recommended\)\n/);
  });
});
