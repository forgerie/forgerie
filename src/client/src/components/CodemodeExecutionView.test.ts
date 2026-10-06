// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { ToolExecutionPart } from "./shared";
import { ToolExecutionView } from "./ToolExecutionView";
import type { CodemodeExecutionView } from "./CodemodeExecutionView";

afterEach(() => {
  document.body.replaceChildren();
});

const SCRIPT = [
  "// Check the build, then read the config",
  "const build = await tools.bash({ command: 'npm run build' });",
  "const config = await tools.read({ path: 'tsconfig.json' });",
  "text(build.output);",
  "return config;",
].join("\n");

function codemodePart(patch: Partial<ToolExecutionPart> = {}): ToolExecutionPart {
  return {
    type: "toolExecution",
    toolCallId: "call_1",
    toolName: "codemode",
    summary: "Check the build, then read the config",
    args: { code: SCRIPT },
    status: "success",
    content: [
      { type: "text", text: "Script completed\nWall time 2.4 seconds\nOutput:\n" },
      { type: "text", text: "built in 2.1s\n" },
    ],
    details: { calls: [
      { id: "call_1/1", name: "bash", args: "{\"command\":\"npm run build\"}", status: "ok", durationMs: 2_140 },
      { id: "call_1/2", name: "read", args: "{\"path\":\"tsconfig.json\"}", status: "ok", durationMs: 3 },
    ] },
    ...patch,
  };
}

async function mount(execution: ToolExecutionPart, presentation: "full" | "detail" = "detail"): Promise<CodemodeExecutionView> {
  const view = new ToolExecutionView();
  view.execution = execution;
  view.presentation = presentation;
  document.body.append(view);
  await view.updateComplete;
  const body = view.shadowRoot?.querySelector("codemode-execution-view");
  if (body === null || body === undefined) throw new Error("codemode body was not rendered");
  await body.updateComplete;
  return body;
}

function section(view: CodemodeExecutionView, label: string): HTMLElement | null {
  return view.shadowRoot?.querySelector<HTMLElement>(`section[aria-label="${label}"]`) ?? null;
}

describe("codemode step detail", () => {
  it("shows the script, each call it made, and what it printed, in run order", async () => {
    const view = await mount(codemodePart());

    const labels = [...(view.shadowRoot?.querySelectorAll("section") ?? [])].map((node) => node.getAttribute("aria-label"));
    expect(labels).toEqual(["Script", "Calls", "Output"]);
    expect(section(view, "Script")?.querySelector("code")?.textContent).toBe(SCRIPT);
    expect(section(view, "Script")?.querySelector(".hljs-comment")?.textContent).toBe("// Check the build, then read the config");

    const calls = [...(section(view, "Calls")?.querySelectorAll(".call") ?? [])];
    expect(calls.map((call) => call.querySelector(".call-name")?.textContent)).toEqual(["bash", "read"]);
    expect(calls.map((call) => call.querySelector(".call-target")?.textContent)).toEqual(["npm run build", "tsconfig.json"]);
    expect(calls[0]?.querySelector(".call-meta")?.textContent.trim()).toBe("2.1s");
    expect(section(view, "Calls")?.querySelector(".label")?.textContent).toBe("2 calls");

    expect(section(view, "Output")?.querySelector("pre")?.textContent).toBe("built in 2.1s");
    expect(view.shadowRoot?.querySelector(".facts")?.textContent.trim()).toBe("Ran in 2.4s");
  });

  it("keeps a failed call's reason under its row and the script error apart from the output", async () => {
    const view = await mount(codemodePart({
      status: "error",
      content: [
        { type: "text", text: "Script failed\nWall time 0.1 seconds\nOutput:\n" },
        { type: "text", text: "before" },
        { type: "text", text: "Script error:\nError: Command exited with code 1" },
      ],
      details: { calls: [{ name: "bash", args: "{\"command\":\"npm test\"}", status: "error", durationMs: 90, error: "Command exited with code 1" }] },
    }));

    const call = section(view, "Calls")?.querySelector(".call");
    expect(call?.classList.contains("error")).toBe(true);
    expect(call?.querySelector(".call-error")?.textContent).toBe("Command exited with code 1");
    expect(section(view, "Output")?.querySelector("pre")?.classList.contains("failed")).toBe(false);
    expect(section(view, "Script error")?.querySelector("pre")?.textContent).toBe("Error: Command exited with code 1");
  });

  it("draws calls as they run, before the script has printed anything", async () => {
    const view = await mount(codemodePart({
      status: "running",
      content: undefined,
      details: { calls: [{ name: "bash", args: "{\"command\":\"npm test\"}", status: "running" }] },
    }));

    expect(section(view, "Output")).toBeNull();
    expect(section(view, "Calls")?.querySelector(".glyph")?.textContent).toBe("●");
    expect(section(view, "Calls")?.querySelector(".sr-only")?.textContent.trim()).toBe("running");
  });

  it("folds a long script to its opening lines until the reader asks for all of it", async () => {
    const longScript = Array.from({ length: 20 }, (_, index) => `const line${String(index)} = ${String(index)};`).join("\n");
    const view = await mount(codemodePart({ args: { code: longScript } }));

    expect(section(view, "Script")?.querySelector("code")?.textContent.split("\n")).toHaveLength(8);
    const showAll = section(view, "Script")?.querySelector("button");
    expect(showAll?.textContent.trim()).toBe("Show all 20 lines");

    showAll?.click();
    await view.updateComplete;
    expect(section(view, "Script")?.querySelector("code")?.textContent).toBe(longScript);
    expect(section(view, "Script")?.querySelector("button")).toBeNull();
  });

  it("names the step by its script's purpose in the full card header", async () => {
    const view = new ToolExecutionView();
    view.execution = codemodePart();
    document.body.append(view);
    await view.updateComplete;

    expect(view.shadowRoot?.querySelector(".tool-title strong")?.textContent).toBe("codemode");
    expect(view.shadowRoot?.querySelector(".summary")?.textContent).toBe("Check the build, then read the config");
    expect(view.shadowRoot?.querySelector(".error-text")).toBeNull();
  });
});
