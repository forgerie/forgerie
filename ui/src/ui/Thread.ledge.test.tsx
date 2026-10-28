// @vitest-environment happy-dom
// The ledge above the input bar: its band and the queue, the handle that folds it away, and the live dot for what
// arrives while folded.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedMessage } from "../queue";
import { useThreadMessages } from "../useThreadMessages";
import { Thread } from "./Thread";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

function Fixture({ keys, items = [], readOnly = false }: { keys: string[]; items?: QueuedMessage[]; readOnly?: boolean }) {
  const runtime = useExternalStoreRuntime({ messages: useThreadMessages([], true), onNew: async () => {}, isRunning: true });
  return <AssistantRuntimeProvider runtime={runtime}><Thread queue={{ items, disabled: false, onClear: () => {} }}
    readOnly={readOnly ? <p>Read only</p> : undefined}
    ledge={{ count: keys.length, noun: keys.length === 1 ? "proposal" : "proposals", keys, content: keys.length ? <div data-ledge-band>{keys.join(" ")}</div> : null }} /></AssistantRuntimeProvider>;
}
const render = (props: Parameters<typeof Fixture>[0]) => act(async () => root.render(<Fixture {...props} />));
const ledge = () => document.querySelector("section.ledge");
const handle = () => document.querySelector<HTMLButtonElement>("button.fold-handle");

describe("the ledge above the input bar", () => {
  it("sits in the dock right above the bar, with the band over the queue", async () => {
    await render({ keys: ["p:1"], items: [{ kind: "followUp", text: "add tests" }] });
    const dock = document.querySelector(".composer-dock")!;
    expect(dock.firstElementChild).toBe(ledge());
    expect(ledge()?.nextElementSibling?.classList.contains("composer")).toBe(true);
    expect(ledge()?.getAttribute("aria-label")).toBe("Waiting at the input");
    expect([...ledge()!.querySelectorAll("[data-ledge-band]")].map((band) => band.getAttribute("aria-label") ?? band.textContent)).toEqual(["p:1", "Queued messages"]);
    // The handle comes right after the attach button, and counts both.
    const slots = [...document.querySelectorAll(".composer-actions > .composer-slot")].map((slot) => slot.getAttribute("data-slot"));
    expect(slots.slice(0, 2)).toEqual(["attach", "handle"]);
    expect(handle()?.textContent).toBe("1 proposal, 1 queued");
    expect(handle()?.getAttribute("aria-label")).toBe("Fold 1 proposal, 1 queued away");
  });

  it("folds away with one press and stays folded: a new proposal marks the handle and never reopens the ledge", async () => {
    await render({ keys: ["p:1", "p:2"] });
    await act(async () => handle()!.click());
    expect(ledge()?.hasAttribute("data-open")).toBe(false);
    expect(handle()?.getAttribute("aria-expanded")).toBe("false");
    expect(handle()?.getAttribute("aria-label")).toBe("Show 2 proposals");
    expect(handle()?.hasAttribute("data-fresh")).toBe(false);
    await render({ keys: ["p:1", "p:2", "p:3"] });
    expect(ledge()?.hasAttribute("data-open")).toBe(false);
    expect(handle()?.hasAttribute("data-fresh")).toBe(true);
    expect(handle()?.getAttribute("aria-label")).toBe("Show 3 proposals, 1 new");
    // One that leaves while folded does not count as new.
    await render({ keys: ["p:2", "p:3"] });
    expect(handle()?.getAttribute("aria-label")).toBe("Show 2 proposals, 1 new");
    await act(async () => handle()!.click());
    expect(ledge()?.hasAttribute("data-open")).toBe(true);
    expect(handle()?.hasAttribute("data-fresh")).toBe(false);
    expect(handle()?.getAttribute("aria-label")).toBe("Fold 2 proposals away");
  });

  it("draws no handle and no open ledge while it holds nothing, and none for a read-only thread", async () => {
    await render({ keys: [] });
    expect(handle()).toBeNull();
    expect(ledge()?.hasAttribute("data-open")).toBe(false);
    await render({ keys: ["p:1"], readOnly: true });
    expect(ledge()).toBeNull();
  });
});
