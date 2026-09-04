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

  it("highlights SQL fences", () => {
    const code = renderedCode("```sql\nSELECT * FROM table\n```");

    expect(code.classList.contains("hljs")).toBe(true);
    expect(code.querySelector(".hljs-keyword")?.textContent).toBe("SELECT");
    expect(code.textContent).toBe("SELECT * FROM table\n");
  });

  it("keeps unknown fenced languages as escaped plain code", () => {
    const code = renderedCode("```diagram\n<node onclick=\"run()\">\n```");

    expect(code.className).toBe("language-diagram");
    expect(code.querySelector("span")).toBeNull();
    expect(code.textContent).toBe("<node onclick=\"run()\">\n");
  });

  it("does not inherit highlight.js aliases outside the shared vocabulary", () => {
    const code = renderedCode("```zsh\necho ready\n```");

    expect(code.className).toBe("language-zsh");
    expect(code.querySelector("span")).toBeNull();
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

describe("rendered Markdown tables", () => {
  const table = "| Option | Cost |\n| --- | --- |\n| Reflow | Tall rows |\n";

  it("gives every cell the heading it belongs to, so a stacked row still reads", () => {
    const cells = renderedTable(table).querySelectorAll("tbody td");

    expect([...cells].map((cell) => cell.getAttribute("data-label"))).toEqual(["Option", "Cost"]);
  });

  it("names the table roles the elements already have, so stacking cannot drop them", () => {
    const rendered = renderedTable(table);

    expect(rendered.getAttribute("role")).toBe("table");
    expect(rendered.querySelector("tbody")?.getAttribute("role")).toBe("rowgroup");
    expect(rendered.querySelector("tbody tr")?.getAttribute("role")).toBe("row");
    expect(rendered.querySelector("tbody td")?.getAttribute("role")).toBe("cell");
    expect(rendered.querySelector("thead th")?.getAttribute("role")).toBe("columnheader");
  });

  it("keeps a cell's contents in one box, so a stacked record cannot tear a sentence up", () => {
    const cell = renderedTable("| Option | Cost |\n| --- | --- |\n| Reflow | `tall.ts` rows and prose |\n").querySelectorAll("tbody td")[1];

    const value = cell?.firstElementChild;
    expect(cell?.childNodes.length).toBe(1);
    expect(value?.className).toBe("cell-value");
    expect(value?.querySelector("code")?.textContent).toBe("tall.ts");
    expect(value?.textContent).toBe("tall.ts rows and prose");
  });

  it("writes the first column's heading once, because each record reads it as a title", () => {
    const rendered = renderedTable(table);

    expect(rendered.querySelector("tbody")?.getAttribute("data-record-label")).toBe("Option");
  });

  it("leaves a nameless first column without a record heading rather than an empty line", () => {
    const rendered = renderedTable("|  | Cost |\n| --- | --- |\n| Reflow | Tall rows |\n");

    expect(rendered.querySelector("tbody")?.hasAttribute("data-record-label")).toBe(false);
  });

  it("leaves an empty cell empty, so a record spends no line on it", () => {
    const cells = renderedTable("| Option | Cost |\n| --- | --- |\n| Reflow |  |\n").querySelectorAll("tbody td");

    expect(cells[1]?.childNodes.length).toBe(0);
  });

  it("leaves an empty heading off its column rather than labelling a cell with nothing", () => {
    const cells = renderedTable("| Option |  |\n| --- | --- |\n| Reflow | Tall rows |\n").querySelectorAll("tbody td");

    expect([...cells].map((cell) => cell.getAttribute("data-label"))).toEqual(["Option", null]);
  });

  it("keeps the table in a scroll region, which is what a reader gets if it is never measured", () => {
    const wrapper = renderedTable(table).parentElement;

    expect(wrapper?.className).toBe("table-scroll");
    expect(wrapper?.getAttribute("tabindex")).toBe("0");
  });
});

function renderedTable(markdown: string): HTMLTableElement {
  const root = document.createElement("div");
  root.innerHTML = toSafeMarkdownHtml(markdown);
  const table = root.querySelector("table");
  if (table === null) throw new Error("Expected a rendered table");
  return table;
}

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
