// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerChoiceList, type ComposerChoiceGroup } from "./ComposerChoiceList";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const models: ComposerChoiceGroup[] = [
  {
    label: "anthropic",
    items: [
      { value: "anthropic/claude-opus-4-8", label: "claude-opus-4-8", meta: "1 000 000" },
      { value: "anthropic/claude-haiku-4-5", label: "claude-haiku-4-5", meta: "200 000" },
    ],
  },
  {
    label: "aka-llama",
    items: [
      { value: "aka-llama/qwen2.5-coder-32b-q4-k-s", label: "qwen2.5-coder-32b-q4-k-s", meta: "8 192", muted: true },
    ],
  },
];

/**
 * One list serves every composer choice. It is sized by its content: a search
 * field appears only when there is more to search than fits, and a group
 * heading only when a group is named.
 */
describe("composer-choice-list", () => {
  it("groups by heading and marks the current choice", async () => {
    const list = await mount({ groups: models, selectedValue: "anthropic/claude-opus-4-8" });

    expect(headings(list)).toEqual(["anthropic", "aka-llama"]);
    expect(rows(list)).toHaveLength(3);
    expect(required(list, "[data-value='anthropic/claude-opus-4-8']").getAttribute("aria-checked")).toBe("true");
    expect(required(list, "[data-value='anthropic/claude-haiku-4-5']").getAttribute("aria-checked")).toBe("false");
  });

  it("returns the value that was picked", async () => {
    const onPick = vi.fn();
    const list = await mount({ groups: models, onPick });

    required(list, "[data-value='anthropic/claude-haiku-4-5']").click();

    expect(onPick).toHaveBeenCalledWith("anthropic/claude-haiku-4-5");
  });

  it("filters over label and group, and names a query that matches nothing", async () => {
    const list = await mount({ groups: models, searchable: true });

    await search(list, "haiku");
    expect(rows(list).map((row) => row.dataset["value"])).toEqual(["anthropic/claude-haiku-4-5"]);

    await search(list, "aka");
    expect(rows(list)).toHaveLength(1);

    await search(list, "gpt-6");
    expect(rows(list)).toHaveLength(0);
    expect(required(list, ".choice-empty").textContent).toContain("gpt-6");
  });

  it("offers no search field when it was not asked for", async () => {
    const list = await mount({ groups: models });

    expect(list.shadowRoot?.querySelector(".choice-search")).toBeNull();
  });

  it("states an unavailable catalogue and offers to retry", async () => {
    const onRetry = vi.fn();
    const list = await mount({ groups: [], error: "Session daemon unavailable", onRetry });

    expect(required(list, ".choice-error").textContent).toContain("Session daemon unavailable");
    required(list, "[data-action='retry']").click();

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("keeps an unavailable row visible, and refuses to pick it", async () => {
    const onPick = vi.fn();
    const list = await mount({ groups: models, onPick });
    const muted = required(list, "[data-value='aka-llama/qwen2.5-coder-32b-q4-k-s']");

    expect(muted.hasAttribute("data-muted")).toBe(true);
    muted.click();

    expect(onPick).toHaveBeenCalledWith("aka-llama/qwen2.5-coder-32b-q4-k-s");
  });

  it("does not pick a row that is disabled", async () => {
    const onPick = vi.fn();
    const list = await mount({
      groups: [{ items: [{ value: "high", label: "high", disabled: true, meta: "unavailable" }] }],
      onPick,
    });

    required(list, "[data-value='high']").click();

    expect(onPick).not.toHaveBeenCalled();
  });
});

async function mount(options: {
  groups: ComposerChoiceGroup[];
  selectedValue?: string;
  searchable?: boolean;
  error?: string;
  onPick?: (value: string) => void;
  onRetry?: () => void;
}): Promise<ComposerChoiceList> {
  const list = new ComposerChoiceList();
  list.groups = options.groups;
  if (options.selectedValue !== undefined) list.selectedValue = options.selectedValue;
  list.searchable = options.searchable ?? false;
  if (options.error !== undefined) list.error = options.error;
  if (options.onPick !== undefined) list.onPick = options.onPick;
  if (options.onRetry !== undefined) list.onRetry = options.onRetry;
  document.body.append(list);
  await list.updateComplete;
  return list;
}

async function search(list: ComposerChoiceList, query: string): Promise<void> {
  const input = list.shadowRoot?.querySelector("input");
  if (!(input instanceof HTMLInputElement)) throw new Error("Expected a search field");
  input.value = query;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await list.updateComplete;
}

function rows(list: ComposerChoiceList): HTMLElement[] {
  return Array.from(list.shadowRoot?.querySelectorAll<HTMLElement>("[data-value]") ?? []);
}

function headings(list: ComposerChoiceList): string[] {
  return Array.from(list.shadowRoot?.querySelectorAll(".choice-group") ?? []).map((node) => node.textContent.trim());
}

function required(list: ComposerChoiceList, selector: string): HTMLElement {
  const found = list.shadowRoot?.querySelector(selector);
  if (!(found instanceof HTMLElement)) throw new Error(`Expected ${selector}`);
  return found;
}
