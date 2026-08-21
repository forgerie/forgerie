// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { toSafeMarkdownHtml } from "./markdown";

describe("toSafeMarkdownHtml", () => {
  it("highlights a fenced TypeScript code block from its language tag", () => {
    const code = renderedCode("```typescript\nconst answer: number = 42;\n```");

    expect(code.classList.contains("language-typescript")).toBe(true);
    expect(code.querySelector(".hljs-keyword")?.textContent).toBe("const");
    expect(code.textContent).toBe("const answer: number = 42;\n");
  });

  it("uses common Markdown language aliases", () => {
    const code = renderedCode("```js\nexport const answer = true;\n```");

    expect(code.classList.contains("language-js")).toBe(true);
    expect(code.querySelector(".hljs-keyword")?.textContent).toBe("export");
    expect(code.querySelector(".hljs-literal")?.textContent).toBe("true");
  });

  it("highlights shell fences with the Bash grammar", () => {
    const code = renderedCode("```shell\nif true; then echo ready; fi\n```");

    expect(code.classList.contains("hljs")).toBe(true);
    expect(code.querySelector(".hljs-keyword")?.textContent).toBe("if");
  });

  it("keeps unknown fenced languages as escaped plain code", () => {
    const code = renderedCode("```diagram\n<node onclick=\"run()\">\n```");

    expect(code.className).toBe("language-diagram");
    expect(code.querySelector("span")).toBeNull();
    expect(code.textContent).toBe("<node onclick=\"run()\">\n");
  });

  it("keeps supported HTML code as text", () => {
    const code = renderedCode("~~~html\n<img src=\"x\" onerror=\"run()\">\n~~~");

    expect(code.classList.contains("hljs")).toBe(true);
    expect(code.querySelector("img")).toBeNull();
    expect(code.textContent).toBe("<img src=\"x\" onerror=\"run()\">\n");
  });

  it("does not guess a language for untagged code blocks", () => {
    const code = renderedCode("```\nconst plain = true;\n```");

    expect(code.className).toBe("");
    expect(code.querySelector("span")).toBeNull();
    expect(code.textContent).toBe("const plain = true;\n");
  });

  it("preserves trailing blank lines inside fenced code", () => {
    const code = renderedCode("```typescript\nconst answer = 42;\n\n\n```");

    expect(code.textContent).toBe("const answer = 42;\n\n");
  });

  it("defers highlighting until a streamed fence closes", () => {
    const code = renderedCode("```typescript\nconst answer = 42;");

    expect(code.className).toBe("language-typescript");
    expect(code.querySelector("span")).toBeNull();
  });

  it("bounds cumulative highlighting across one Markdown message", () => {
    const source = "const value = true;\n".repeat(170);
    const codes = renderedCodes(Array.from({ length: 3 }, () => `\`\`\`typescript\n${source}\`\`\``).join("\n\n"));

    expect(codes[0]?.classList.contains("hljs")).toBe(true);
    expect(codes[1]?.classList.contains("hljs")).toBe(true);
    expect(codes[2]?.className).toBe("language-typescript");
    expect(codes[2]?.querySelector("span")).toBeNull();
  });

  it("leaves oversized fenced code plain", () => {
    const source = "const answer = true;\n".repeat(5_000);
    const code = renderedCode(`\`\`\`typescript\n${source}\`\`\``);

    expect(code.className).toBe("language-typescript");
    expect(code.querySelector("span")).toBeNull();
    expect(code.textContent).toBe(source);
  });
});

function renderedCode(markdown: string): HTMLElement {
  const code = renderedCodes(markdown)[0];
  if (code === undefined) throw new Error("Expected a rendered code block");
  return code;
}

function renderedCodes(markdown: string): HTMLElement[] {
  const root = document.createElement("div");
  root.innerHTML = toSafeMarkdownHtml(markdown);
  return Array.from(root.querySelectorAll("pre code")).filter((code): code is HTMLElement => code instanceof HTMLElement);
}
