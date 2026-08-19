// @vitest-environment happy-dom

import { html, render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import { renderWorkspaceLabelInlineItems } from "./workspaceLabel";

afterEach(() => {
  document.body.replaceChildren();
});

describe("renderWorkspaceLabelInlineItems", () => {
  it("renders text, safe links, custom content, and separators", () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(renderWorkspaceLabelInlineItems([
      { type: "text", text: "main", title: "Current branch" },
      { type: "link", text: "PR 42", href: "https://example.test/pr/42" },
      { type: "render", render: () => html`<strong>clean</strong>` },
    ]), container);

    expect(container.textContent).toBe("main·PR 42·clean");
    expect(container.querySelectorAll(".workspace-label-separator")).toHaveLength(2);
    expect(container.querySelector(".workspace-label-item")?.getAttribute("title")).toBe("Current branch");
    expect(container.querySelector("a")?.getAttribute("target")).toBe("_blank");
    expect(container.querySelector("a")?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.querySelector("strong")?.textContent).toBe("clean");
  });

  it("honors same-page links without adding opener protection", () => {
    const container = document.createElement("div");

    render(renderWorkspaceLabelInlineItems([
      { type: "link", text: "local", href: "/workspace", target: "_self" },
    ]), container);

    expect(container.querySelector("a")?.getAttribute("target")).toBe("_self");
    expect(container.querySelector("a")?.getAttribute("rel")).toBe("");
  });

  it.each(["", "   ", "javascript:alert(1)", " DATA:text/html,unsafe"])("renders unsafe link %j as text", (href) => {
    const container = document.createElement("div");

    render(renderWorkspaceLabelInlineItems([{ type: "link", text: "unsafe", href }]), container);

    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("span.workspace-label-item")?.textContent).toBe("unsafe");
  });

  it("renders no nodes for an absent catalog", () => {
    expect(renderWorkspaceLabelInlineItems()).toEqual([]);
  });
});
