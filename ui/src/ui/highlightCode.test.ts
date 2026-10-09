import { describe, expect, it } from "vitest";
import hljs from "./codeGrammars";
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
  it("highlights a fence label that the common subset leaves out", () => {
    const nix = highlightCode('let home = "/var/lib/nix"; # comment\nin { }', "nix");
    expect(nix).toContain('<span class="hljs-keyword">let</span>');
    expect(nix).toContain("hljs-string");
    expect(nix).toContain("hljs-comment");
    expect(highlightCode("FROM alpine:3.20", "dockerfile")).toContain("hljs-keyword");
    expect(highlightCode("cmake_minimum_required(VERSION 3.20)", "cmake")).toContain("hljs-number");
  });
  it("tests the label against every grammar highlight.js ships, not its common subset", () => {
    // The subset carries 36 languages. Each label here is one it drops.
    for (const label of ["nix", "dockerfile", "cmake", "powershell", "elixir", "matlab", "nim", "http", "properties", "nginx"])
      expect(hljs.getLanguage(label), label).toBeTruthy();
  });
});
