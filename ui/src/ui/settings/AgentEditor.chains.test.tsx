// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentEditor } from "./AgentEditor";

const MODELS = [
  { provider: "anthropic", id: "claude-opus-5-5", name: "Claude Opus 5.5", reasoning: true },
  { provider: "openai", id: "gpt-5", name: "GPT-5", reasoning: true },
];
const CHAINS = { worker: ["anthropic/claude-opus-5-5:high", "openai/gpt-5"], fast: ["openai/gpt-5"] };

let root: Root;
let fileText: string;
let writes: string[];
const settle = () => act(async () => { for (let index = 0; index < 10; index++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const click = async (node: HTMLElement) => { await act(async () => node.click()); await settle(); };
const field = (label: string) => [...document.querySelectorAll(".agent-field")].find((node) => node.querySelector(".agent-field-label")?.textContent === label)!;
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });

async function open(text: string) {
  fileText = text;
  await act(async () => root.render(<AgentEditor target={{ type: "user", file: "helper.md" }} home="/home/me"
    onBack={() => {}} onOpen={() => {}} onSaved={() => {}} />));
  await settle();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  writes = [];
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/models")) return json({ models: MODELS });
    if (url === "/aui/model-prefs") return json({ modelChains: CHAINS, modelChainsProblem: null });
    if (url.startsWith("/aui/agents/user/helper.md")) {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { text: string };
        writes.push(body.text);
        return json({ scope: "user", file: "helper.md", text: body.text, mtimeMs: 2 });
      }
      return json({ scope: "user", file: "helper.md", text: fileText, mtimeMs: 1 });
    }
    return new Response("{}", { status: 404 });
  });
  localStorage.clear();
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); localStorage.clear(); vi.unstubAllGlobals(); });

describe("an agent's model chain", () => {
  it("shows the chain the agent names, offers chains as their own group, and saves a choice of chain", async () => {
    await open("---\nname: helper\ndescription: Helps.\nmodel: worker:medium\n---\n\nHelp.\n");
    const model = field("Model");
    expect(model.querySelector(".model-trigger")?.textContent).toContain("worker");
    expect(model.querySelector(".model-trigger")?.textContent).toContain("Medium");
    expect(model.textContent).toContain("Runs try Claude Opus 5.5 (High), then GPT-5, moving on when a model is unavailable.");
    await click(model.querySelector<HTMLButtonElement>(".model-trigger")!);
    const groups = [...document.querySelectorAll(".floating-panel .option-list-group")];
    expect(groups[0]?.textContent).toContain("Model chains");
    const chainRows = [...groups[0]!.querySelectorAll<HTMLButtonElement>(".option-row")];
    expect(chainRows.map((row) => row.querySelector(".option-row-name")?.textContent)).toEqual(["worker", "fast"]);
    expect(chainRows[0]?.getAttribute("aria-current")).toBe("true");
    expect(chainRows[0]?.textContent).toContain("Claude Opus 5.5 (High), then GPT-5");
    expect(groups.slice(1).map((group) => group.textContent).join(" ")).toContain("Claude Opus 5.5");
    await click(chainRows[1]!);
    expect(model.querySelector(".model-trigger")?.textContent).toContain("fast");
    await click([...document.querySelectorAll<HTMLButtonElement>(".settings-primary")].find((node) => node.textContent === "Save")!);
    // The level written into the chain reference moves to its own field, as it does for a model.
    expect(writes.at(-1)).toContain("model: fast\n");
    expect(writes.at(-1)).toContain("thinking: medium\n");
  });

  it("says when the chain the agent names does not exist", async () => {
    await open("---\nname: helper\ndescription: Helps.\nmodel: gone\n---\n\nHelp.\n");
    const model = field("Model");
    expect(model.querySelector(".model-trigger")?.textContent).toContain("gone");
    expect(model.querySelector(".agent-field-problem")?.textContent).toBe("No model chain is named gone. Choose a chain or a model, or create the chain in Settings > Models.");
    // The problem describes the picker to a screen reader.
    expect(model.querySelector(".model-trigger")?.getAttribute("aria-describedby")).toContain(model.querySelector(".agent-field-problem")!.id);
  });

  it("reads only the map's own chains: an agent that names constructor gets the missing-chain error", async () => {
    await open("---\nname: helper\ndescription: Helps.\nmodel: constructor\n---\n\nHelp.\n");
    expect(field("Model").querySelector(".agent-field-problem")?.textContent).toContain("No model chain is named constructor.");
  });

  it("keeps a single model as it was, with no problem", async () => {
    await open("---\nname: helper\ndescription: Helps.\nmodel: openai/gpt-5\n---\n\nHelp.\n");
    const model = field("Model");
    expect(model.querySelector(".model-trigger")?.textContent).toContain("GPT-5");
    expect(model.querySelector(".agent-field-problem")).toBeNull();
  });
});
