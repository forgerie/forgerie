// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginsView, plainName, tildify } from "./PluginsView";
import type { PluginsApi } from "../../plugins/pluginsApi";
import type { PluginCatalog, PluginChange } from "@shared/pluginsContract";

let root: Root;
let catalog: PluginCatalog;
let calls: PluginChange[];
let restarts: number;
let selected: string | undefined;
let api: PluginsApi;
const settle = () => act(async () => { for (let index = 0; index < 6; index++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === text || node.getAttribute("aria-label") === text)!;
const click = async (text: string) => { const node = button(text); expect(node, text).toBeDefined(); await act(async () => node.click()); await settle(); };
const command = async (text: string) => { await click("Plugin commands"); await click(text); };
async function render() { await act(async () => root.render(<PluginsView selected={selected} api={api} onOpen={(id) => { selected = id; }} onBack={() => {}} />)); await settle(); }
async function type(selector: string, text: string) {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, text); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
const status = () => document.querySelector(".connection-status")?.textContent;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  selected = undefined; calls = []; restarts = 0;
  catalog = { profileDir: "/home/me/.forgerie/agent", configPath: "/home/me/.config/forgerie.json", home: "/home/me", revision: "v1", restartRequired: false, restartAvailable: true,
    plugins: [ { id: "package:pi-goal", kind: "package", name: "@narumitw/pi-goal", source: "npm:@narumitw/pi-goal", version: "0.49.6", installed: true, description: "Autonomous /goal completion.", enabled: true },
      { id: "package:gone", kind: "package", name: "pi-gone", source: "/home/me/code/pi-gone", installed: false, description: "", enabled: false },
      { id: "forgerie:quota", kind: "forgerie", name: "quota", source: "local", description: "", enabled: true, settings: { five_hour: false } },
      { id: "builtin:pi-subagents", kind: "builtin", name: "pi-subagents", source: "Forgerie", description: "Lets a session hand work to the agents in Settings.", enabled: true } ] };
  api = { list: async () => catalog,
    change: async (revision, change) => {
      if (revision !== catalog.revision) throw new Error("Reload before saving");
      calls.push(change);
      catalog = { ...catalog, revision: "v2", restartRequired: true, plugins: catalog.plugins.map((entry) => change.type === "toggle" && entry.id === change.id ? { ...entry, enabled: change.enabled } : entry) };
      return catalog;
    },
    restart: async () => { restarts += 1; catalog = { ...catalog, restartRequired: false }; return catalog; },
  };
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("plugin words", () => {
  it("drops an npm scope from the shown name and writes home as ~", () => {
    expect(plainName(catalog.plugins[0]!)).toBe("pi-goal");
    expect(plainName({ ...catalog.plugins[2]!, name: "@not/a-package" })).toBe("@not/a-package");
    expect(tildify("/home/me/code/x", "/home/me")).toBe("~/code/x");
    expect(tildify("/home/meg/code", "/home/me")).toBe("/home/meg/code");
  });
});

describe("Plugins settings", () => {
  it("lists real names and descriptions, and speaks only for unusual rows", async () => {
    await render();
    expect([...document.querySelectorAll("section")].map((node) => node.getAttribute("aria-label"))).toEqual(["Pi packages", "Pi extensions", "Forgerie plugins", "Built in"]);
    const rows = [...document.querySelectorAll(".agent-row")].map((node) => node.textContent);
    expect(rows[0]).toBe("pi-goal0.49.6Autonomous /goal completion.");
    expect(rows[1]).toBe("pi-gone~/code/pi-goneTurned offNot installed");
    expect(rows[2]).toBe("quotaInstalled on this machine");
    expect(document.querySelector(".agent-row[data-dimmed]")!.textContent).toContain("pi-gone");
    expect(document.body.textContent).toContain("Saved in ~/.forgerie/agent");
    expect(document.body.textContent).not.toContain("Restart Forgerie to apply");
    await act(async () => (document.querySelectorAll<HTMLButtonElement>(".agent-row")[2]!).click());
    expect(selected).toBe("forgerie:quota");
    expect(calls).toEqual([]);
  });
  it("installs from the header, then reports it without restarting", async () => {
    selected = "new"; await render();
    expect(button("Install").disabled).toBe(true);
    expect(button("Install").closest(".session-header")).not.toBeNull();
    await type("#plugin-source", "  npm:test-package  ");
    await click("Install");
    expect(calls).toEqual([{ type: "add", source: "npm:test-package" }]);
    expect(restarts).toBe(0);
    expect(selected).toBeUndefined();
    expect(status()).toBe("Installed");
  });
  it("turns a Pi package off, then keeps the restart notice under the header", async () => {
    selected = "package:pi-goal"; await render();
    expect(document.querySelector("h2.agent-name")!.textContent).toBe("pi-goal");
    expect(document.body.textContent).toContain("npm:@narumitw/pi-goal");
    await click("Load pi-goal");
    expect(calls).toEqual([{ type: "toggle", id: "package:pi-goal", enabled: false }]);
    expect(document.querySelector("[role=switch]")!.getAttribute("aria-checked")).toBe("false");
    expect(document.querySelector(".notice[data-tone=pending]")!.textContent).toContain("Restart Forgerie to apply your changes");
    expect(status()).toBe("Saved");
  });
  it("names a package that is configured but not on disk", async () => {
    selected = "package:gone"; await render();
    expect(document.body.textContent).toContain("Not installed");
    expect(document.body.textContent).toContain("Install it again, or remove it.");
  });
  it("does not edit built-in add-ons", async () => {
    selected = "builtin:pi-subagents"; await render();
    expect(button("Load pi-subagents").disabled).toBe(true);
    expect(document.body.textContent).toContain("You cannot turn it off here.");
  });
  it("validates a JSON object and saves settings only on demand", async () => {
    selected = "forgerie:quota"; await render();
    await type("textarea", "[]");
    expect(document.querySelector("[role=alert]")!.textContent).toContain("JSON object");
    expect(button("Save").disabled).toBe(true);
    await type("textarea", '{"five_hour": true}');
    expect(status()).toBe("Unsaved changes");
    expect(calls).toEqual([]);
    await click("Save");
    expect(calls).toEqual([{ type: "settings", id: "forgerie:quota", settings: { five_hour: true } }]);
    expect(button("Save").disabled).toBe(true);
    expect(localStorage.length).toBe(0);
  });
  it("holds an unsaved draft across navigation and refuses to silently rebase it", async () => {
    selected = "forgerie:quota"; await render();
    await type("textarea", '{"five_hour": false, "private_key": "not-in-browser-storage"}');
    selected = undefined; await render();
    catalog = { ...catalog, revision: "outside-change" };
    selected = "forgerie:quota"; await render();
    await command("Read plugins again");
    await click("Save");
    expect(document.body.textContent).toContain("Reload before saving");
    expect(localStorage.length).toBe(0);
    await command("Discard changes");
    expect(status()).toBeUndefined();
  });
  it("confirms a restart in a window, and Cancel restarts nothing", async () => {
    selected = "package:pi-goal"; await render();
    await command("Restart Forgerie…");
    expect(document.querySelector("dialog")!.textContent).toContain("stops every running agent");
    await click("Cancel"); expect(restarts).toBe(0);
    await command("Restart Forgerie…"); await click("Stop runs and restart");
    expect(restarts).toBe(1);
    expect(status()).toBe("Restarted");
  });
  it("asks twice in the menu before it removes a package", async () => {
    selected = "package:pi-goal"; await render();
    await command("Remove package");
    expect(calls).toEqual([]);
    await click("Remove? Its code stays on disk");
    expect(calls).toEqual([{ type: "remove", id: "package:pi-goal" }]);
    expect(selected).toBeUndefined();
  });
  it("clears a failed refresh after a successful retry", async () => {
    let fail = false;
    api = { ...api, list: async () => { if (fail) throw new Error("Gateway unavailable"); return catalog; } };
    await render();
    fail = true; await command("Read plugins again");
    expect(document.body.textContent).toContain("Gateway unavailable");
    fail = false; await click("Retry");
    expect(document.body.textContent).not.toContain("Gateway unavailable");
    expect(document.body.textContent).toContain("Pi packages");
  });
  it("shows a read failure and retries", async () => {
    let fail = true;
    api = { ...api, list: async () => { if (fail) throw new Error("sessiond is unavailable"); return catalog; } };
    await render(); expect(document.body.textContent).toContain("sessiond is unavailable");
    fail = false; await click("Retry"); expect(document.body.textContent).toContain("Pi packages");
  });
});
