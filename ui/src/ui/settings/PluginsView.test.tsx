// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginsView } from "./PluginsView";
import type { PluginCatalog, PluginChange, PluginsApi } from "../../plugins/pluginsApi";

let root: Root;
let catalog: PluginCatalog;
let calls: PluginChange[];
let restarts: number;
let selected: string | undefined;
let api: PluginsApi;
const settle = () => act(async () => { for (let index = 0; index < 6; index++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === text || node.getAttribute("aria-label") === text)!;
const click = async (text: string) => { const node = button(text); expect(node).toBeDefined(); await act(async () => node.click()); await settle(); };
async function render() { await act(async () => root.render(<PluginsView selected={selected} api={api} onOpen={(id) => { selected = id; }} onBack={() => {}} />)); await settle(); }
async function textarea(text: string) {
  const input = document.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  selected = undefined; calls = []; restarts = 0;
  catalog = { profileDir: "/owned/agent", configPath: "/owned/config.json", revision: "v1", restartRequired: false, restartAvailable: true,
    plugins: [ { id: "package:pi-goal", kind: "package", name: "pi-goal", source: "npm:pi-goal", description: "Pi package", enabled: true },
      { id: "forgerie:quota", kind: "forgerie", name: "quota", source: "local", description: "Browser plugin", enabled: true, settings: { five_hour: false } },
      { id: "builtin:pi-subagents", kind: "builtin", name: "pi-subagents", source: "Forgerie", description: "Delegated agents", enabled: true } ] };
  api = { list: async () => catalog,
    change: async (revision, change) => {
      if (revision !== catalog.revision) throw new Error("Reload before saving");
      calls.push(change);
      catalog = { ...catalog, revision: "v2", restartRequired: true, plugins: catalog.plugins.map((entry) => change.type === "toggle" && entry.id === change.id ? { ...entry, enabled: change.enabled } : entry) };
      return catalog;
    },
    restart: async () => { restarts += 1; return { ...catalog, restartRequired: false }; },
  };
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("Plugins settings", () => {
  it("shows both plugin kinds and built-ins, and opens a row without changing it", async () => {
    await render();
    expect([...document.querySelectorAll("section")].map((node) => node.getAttribute("aria-label"))).toEqual(["Pi packages", "Pi extensions", "Forgerie plugins", "Built in"]);
    expect(document.body.textContent).toContain("/owned/agent");
    await click("quotaOnBrowser plugin");
    expect(selected).toBe("forgerie:quota");
    expect(calls).toEqual([]);
  });
  it("installs from the header, without waiting for a service restart", async () => {
    selected = "new"; await render();
    expect(button("Install package").disabled).toBe(true);
    expect(button("Install package").closest(".session-header")).not.toBeNull();
    const input = document.querySelector<HTMLInputElement>("#plugin-source")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "  npm:test-package  ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Install package");
    expect(calls).toEqual([{ type: "add", source: "npm:test-package" }]);
    expect(restarts).toBe(0);
    expect(selected).toBeUndefined();
  });
  it("turns a Pi package off and retains a restart notice", async () => {
    selected = "package:pi-goal"; await render();
    await click("Enable pi-goal");
    expect(calls).toEqual([{ type: "toggle", id: "package:pi-goal", enabled: false }]);
    expect(document.querySelector("[role=switch]")!.getAttribute("aria-checked")).toBe("false");
    expect(document.body.textContent).toContain("Restart needed");
  });
  it("does not edit built-in add-ons", async () => {
    selected = "builtin:pi-subagents"; await render();
    expect(button("Enable pi-subagents").disabled).toBe(true);
    expect(document.body.textContent).toContain("read-only");
  });
  it("validates a JSON object and saves settings only on demand", async () => {
    selected = "forgerie:quota"; await render();
    await textarea("[]");
    expect(document.querySelector("[role=alert]")!.textContent).toContain("JSON object");
    expect(button("Save settings").disabled).toBe(true);
    await textarea('{"five_hour": true}');
    expect(calls).toEqual([]);
    await click("Save settings");
    expect(calls).toEqual([{ type: "settings", id: "forgerie:quota", settings: { five_hour: true } }]);
    expect(button("Save settings").disabled).toBe(true);
    expect(localStorage.length).toBe(0);
  });
  it("holds an unsaved draft across navigation and refuses to silently rebase it", async () => {
    selected = "forgerie:quota"; await render();
    await textarea('{"five_hour": false, "private_key": "not-in-browser-storage"}');
    selected = undefined; await render();
    catalog = { ...catalog, revision: "outside-change" };
    selected = "forgerie:quota"; await render();
    await click("Reload plugins");
    await click("Save settings");
    expect(document.body.textContent).toContain("Reload before saving");
    expect(localStorage.length).toBe(0);
    await click("Discard changes");
  });
  it("requires confirmation before restart and remove, and Cancel writes nothing", async () => {
    selected = "package:pi-goal"; await render();
    await click("Restart services");
    expect(document.querySelector("dialog")!.textContent).toContain("stops active agent runs");
    expect(restarts).toBe(0);
    await click("Cancel"); expect(restarts).toBe(0);
    await click("Restart services"); await click("Stop runs and restart"); expect(restarts).toBe(1);
    await click("Remove package");
    expect(document.querySelector("dialog")!.textContent).toContain("code stays on disk");
    await click("Cancel"); expect(calls).toEqual([]);
    await click("Remove package");
    const confirm = document.querySelector<HTMLButtonElement>("dialog button[data-tone=danger]")!;
    await act(async () => confirm.click()); await settle();
    expect(calls).toEqual([{ type: "remove", id: "package:pi-goal" }]);
  });
  it("clears a failed refresh after a successful retry", async () => {
    let fail = false;
    api = { ...api, list: async () => { if (fail) throw new Error("Gateway unavailable"); return catalog; } };
    await render();
    fail = true; await click("Reload plugins");
    expect(document.body.textContent).toContain("Gateway unavailable");
    fail = false; await click("Reload plugins");
    expect(document.body.textContent).not.toContain("Gateway unavailable");
    expect(document.body.textContent).toContain("Pi packages");
  });
  it("shows a read failure and retries", async () => {
    let fail = true;
    api = { ...api, list: async () => { if (fail) throw new Error("sessiond is unavailable"); return catalog; } };
    await render(); expect(document.body.textContent).toContain("sessiond is unavailable");
    fail = false; await click("Reload"); expect(document.body.textContent).toContain("Pi packages");
  });
});
