// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProcessEventView } from "./ProcessEventView";
import { parseProcessEvent } from "./processEvent";
import { failedXml, matchedXml, stoppedXml, succeededXml } from "./fixtures/processEvents";
import { fromHistory } from "../transcript";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
const button = (text: string) => [...document.querySelectorAll("button")].find((node) => node.textContent === text);

describe("process event view", () => {
  it("draws a success as one line whose command opens on request", async () => {
    await act(async () => root.render(<ProcessEventView event={parseProcessEvent(succeededXml)!} />));
    expect(document.querySelector(".event-line")?.getAttribute("data-tone")).toBe("positive");
    expect(document.querySelector("summary")?.textContent).toBe("cpo-poc-buildsucceeded in 12s");
    expect(document.querySelector(".event-line-code")?.textContent).toBe("cd ~/code/cpo-poc && npm ci && npm run build");
    expect(document.querySelector(".alert-card")).toBeNull();
  });

  it("keeps a matched line visible and makes its address openable", async () => {
    await act(async () => root.render(<ProcessEventView event={{ ...parseProcessEvent(matchedXml)!, repeats: 2 }} />));
    expect(document.querySelector(".event-line-phrase")?.textContent).toBe("printed a watched line 2 times");
    expect(document.querySelector(".event-line-quote a")?.getAttribute("href")).toBe("http://localhost:5173/");
  });

  it("draws a stop as a hollow neutral line", async () => {
    await act(async () => root.render(<ProcessEventView event={parseProcessEvent(stoppedXml)!} />));
    expect(document.querySelector(".event-line")?.hasAttribute("data-hollow")).toBe(true);
  });

  it("draws a failure as a card that explains the exit code and loads output on request", async () => {
    let finish: (text: string) => void = () => {};
    const load = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    await act(async () => root.render(<ProcessEventView event={parseProcessEvent(failedXml)!} onLoadOutput={load} />));
    expect(document.querySelector(".alert-card-title")?.textContent).toBe("oe-preview failed");
    expect(document.querySelector(".alert-card-text")?.textContent).toBe("Exit code 127 after 0s. The shell could not find the command.");
    await act(async () => button("Show output")!.click());
    expect(button("Loading output…")?.disabled).toBe(true);
    await act(async () => finish("vite: not found"));
    expect(document.querySelector(".alert-card-output")?.textContent).toBe("vite: not found");
    await act(async () => button("Hide output")!.click());
    expect(document.querySelector(".alert-card-output")).toBeNull();
    expect(load).toHaveBeenCalledOnce();
  });

  it("reports a failed load in the output panel instead of throwing", async () => {
    await act(async () => root.render(<ProcessEventView event={parseProcessEvent(failedXml)!} onLoadOutput={() => Promise.reject(new Error("gone"))} />));
    await act(async () => button("Show output")!.click());
    expect(document.querySelector(".alert-card-output")?.textContent).toBe("Could not load the output: gone");
  });

  it("offers no output action where nothing can fetch it", async () => {
    await act(async () => root.render(<ProcessEventView event={parseProcessEvent(failedXml)!} />));
    expect(document.querySelector(".alert-card-action")).toBeNull();
  });
});

describe("process events in the transcript", () => {
  it("turns a process notification into a system message that carries the event", () => {
    const { messages } = fromHistory([{ role: "custom", customType: "ad-process:notification", content: failedXml, timestamp: 7 }]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: "system", processEvent: { outcome: "failed", at: 7 } });
  });
});
