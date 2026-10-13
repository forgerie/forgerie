import { describe, expect, it } from "vitest";
import { readmeBody, readmeUrl, resolveReadmeReference } from "./readmeModel";

const repository = { blob: "https://github.com/o/r/blob/HEAD/", raw: "https://raw.githubusercontent.com/o/r/HEAD/", directory: "packages/tool/" };

describe("README model", () => {
  it("drops an opening title that only repeats the plugin's name", () => {
    expect(readmeBody("# pi-fff\n\nFast search.\n", ["pi-fff", "@ff-labs/pi-fff"])).toBe("Fast search.\n");
    expect(readmeBody("# @FF-labs/pi-fff #\nFast.", ["pi-fff", "@ff-labs/pi-fff"])).toBe("Fast.");
    expect(readmeBody("# Fast file search\n\nText", ["pi-fff"])).toBe("# Fast file search\n\nText");
    expect(readmeBody("Intro\n# pi-fff", ["pi-fff"])).toBe("Intro\n# pi-fff");
  });
  it("resolves relative links to GitHub pages and relative images to raw files", () => {
    expect(resolveReadmeReference("docs/use.md", "link", repository)).toBe("https://github.com/o/r/blob/HEAD/packages/tool/docs/use.md");
    expect(resolveReadmeReference("./shot.png", "image", repository)).toBe("https://raw.githubusercontent.com/o/r/HEAD/packages/tool/shot.png");
    expect(resolveReadmeReference("/LICENSE", "link", repository)).toBe("https://github.com/o/r/blob/HEAD/LICENSE");
    expect(resolveReadmeReference("https://npmjs.com/x", "link", repository)).toBe("https://npmjs.com/x");
    expect(resolveReadmeReference("//img.shields.io/x.svg", "image", undefined)).toBe("https://img.shields.io/x.svg");
  });
  it("leaves nothing to open for anchors, or for relative paths without a repository", () => {
    expect(resolveReadmeReference("#install", "link", repository)).toBeUndefined();
    expect(resolveReadmeReference("docs/use.md", "link", undefined)).toBeUndefined();
    expect(resolveReadmeReference("shot.png", "image", undefined)).toBeUndefined();
  });
  it("links the README file itself on GitHub when the repository is known", () => {
    expect(readmeUrl({ text: "x", file: "README.md", truncated: false, repository })).toBe("https://github.com/o/r/blob/HEAD/packages/tool/README.md");
    expect(readmeUrl({ text: "x", file: "README.md", truncated: false })).toBeUndefined();
  });
});
