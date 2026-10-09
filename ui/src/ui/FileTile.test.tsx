import { describe, expect, it } from "vitest";
import { typeMark } from "./FileTile";

describe("a file tile's type mark", () => {
  it("shows a short extension in capitals", () => {
    expect(typeMark("notes.txt")).toBe("TXT");
    expect(typeMark("archive.tar.gz")).toBe("GZ");
  });
  it("falls back to FILE when the name has no usable extension", () => {
    expect(typeMark("Makefile")).toBe("FILE");
    expect(typeMark(".env")).toBe("FILE");
    expect(typeMark("report.verylongext")).toBe("FILE");
  });
});
