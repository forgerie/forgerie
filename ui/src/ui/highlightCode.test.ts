import { describe, expect, it } from "vitest";
import { highlightCode } from "./highlightCode";

describe("Code fence highlighting", () => {
  it("escapes executable markup before returning highlighted HTML", () => {
    const result = highlightCode('<script>alert("unsafe")</script><img src=x onerror=alert(1)>', "html");
    expect(result).toContain("&lt;");
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("<img");
  });
  it("leaves unknown fence labels for the React plain-text renderer", () => {
    expect(highlightCode("<script>unsafe</script>", "not-a-language")).toBeUndefined();
  });
});
