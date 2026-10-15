// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginsView, plainName, tildify } from "./PluginsView";
import { createRuntimeApi, type GatewayKey, type PluginsApi, type RuntimeApi } from "../../plugins/pluginsApi";
import type { PluginCatalog, PluginChange, PluginReadme } from "@shared/pluginsContract";
import { resolveAppSettings } from "@shared/appPlugins";
import { accountMetersManifest, decisionHintsManifest } from "@shared/appPluginManifests";

let root: Root;
let catalog: PluginCatalog;
let calls: PluginChange[];
let restarts: number;
let selected: string | undefined;
let api: PluginsApi;
let readme: PluginReadme;
let readmeReads: string[];
let gatewayKey: GatewayKey;
let runtimeFails = false;
let keyReads: number;
const runtime: RuntimeApi = {
  gatewayKey: async () => { keyReads += 1; if (runtimeFails) throw new Error("sessiond is unavailable"); return gatewayKey; },
  setGatewayKey: async () => ({ keyPresent: true, source: "settings" }),
  clearGatewayKey: async () => ({ keyPresent: false, source: "none" }),
};
const settle = () => act(async () => { for (let index = 0; index < 6; index++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === text || node.getAttribute("aria-label") === text)!;
const click = async (text: string) => { const node = button(text); expect(node, text).toBeDefined(); await act(async () => node.click()); await settle(); };
const command = async (text: string) => { await click("Plugin commands"); await click(text); };
async function render() { await act(async () => root.render(<PluginsView selected={selected} api={api} runtime={runtime} onOpen={(id) => { selected = id; }} onBack={() => {}} />)); await settle(); }
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
      { id: "app:cliproxyapi-quota", kind: "app", name: "Account meters", source: "Forgerie", description: "Shows how much quota each AI account has left, at the foot of the session list.",
        enabled: true, settings: resolveAppSettings(accountMetersManifest, { five_hour: false }), fields: [...accountMetersManifest.settings] },
      { id: "builtin:pi-subagents", kind: "builtin", name: "pi-subagents", source: "Forgerie", description: "Lets a session hand work to the agents in Settings.", enabled: true } ] };
  api = { list: async () => catalog,
    change: async (revision, change) => {
      if (revision !== catalog.revision) throw new Error("Reload before saving");
      calls.push(change);
      // App plugins apply at once; everything else waits for a restart.
      catalog = { ...catalog, revision: "v2", restartRequired: catalog.restartRequired || !("id" in change && change.id.startsWith("app:")),
        plugins: catalog.plugins.map((entry) => change.type === "toggle" && entry.id === change.id ? { ...entry, enabled: change.enabled }
          : change.type === "settings" && entry.id === change.id ? { ...entry, settings: change.settings } : entry) };
      return catalog;
    },
    restart: async () => { restarts += 1; catalog = { ...catalog, restartRequired: false }; return catalog; },
    readme: async (id) => { readmeReads.push(id); return readme; },
  };
  readmeReads = [];
  readme = { text: null, truncated: false };
  gatewayKey = { keyPresent: true, source: "settings" }; keyReads = 0; runtimeFails = false;
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
  it("lists Pi packages, extensions, current app plugins, and built-ins without the retired browser plugins", async () => {
    await render();
    expect([...document.querySelectorAll("section")].map((node) => node.getAttribute("aria-label"))).toEqual(["Pi packages", "Pi extensions", "Forgerie plugins", "Built in"]);
    const rows = [...document.querySelectorAll(".agent-row")].map((node) => node.textContent);
    expect(rows[0]).toBe("pi-goal0.49.6Autonomous /goal completion.");
    expect(rows[1]).toBe("pi-gone~/code/pi-goneTurned offNot installed");
    expect(rows[2]).toContain("Account meters");
    expect(document.body.textContent).not.toContain("Original client plugins");
    expect(document.body.textContent).toContain("Saved in ~/.forgerie/agent");
    await act(async () => document.querySelectorAll<HTMLButtonElement>(".agent-row")[3]!.click());
    expect(selected).toBe("builtin:pi-subagents");
    expect(calls).toEqual([]);
  });
  it("discards an unsaved app address without saving or storing it in the browser", async () => {
    selected = "app:cliproxyapi-quota";
    await render();
    const previous = document.querySelector<HTMLInputElement>("input[type=url]")!.value;
    await type("input[type=url]", "http://127.0.0.1:9000/quota");
    expect(status()).toBe("Unsaved changes");
    expect(calls).toEqual([]);
    await command("Discard changes");
    expect(document.querySelector<HTMLInputElement>("input[type=url]")!.value).toBe(previous);
    expect(localStorage.length).toBe(0);
    expect(status()).toBeUndefined();
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
  it("shows a package's README under its properties, styled like a reply", async () => {
    readme = { file: "README.md", truncated: true, repository: { blob: "https://github.com/o/r/blob/HEAD/", raw: "https://raw.githubusercontent.com/o/r/HEAD/", directory: "" },
      text: "# pi-goal\n\nRuns **goals**. See [usage](docs/usage.md) and [install](#install).\n\n![shot](shot.png) ![badge](http://img.example/b.svg)\n\n"
        + "<p align=\"center\"><script>alert(1)</script><a href=\"javascript:alert(1)\">bad</a></p>\n\n```sh\nnpm i pi-goal\n```\n" };
    selected = "package:pi-goal"; await render();
    expect(readmeReads).toEqual(["package:pi-goal"]);
    const section = document.querySelector(".markdown-article")!;
    expect(section.querySelector("h2")!.textContent).toBe("Readme");
    expect(section.querySelector<HTMLAnchorElement>(".markdown-article-source")!.href).toBe("https://github.com/o/r/blob/HEAD/README.md");
    // The title repeats the page's name, so it is dropped.
    expect(section.querySelector(".markdown-article-body h1")).toBeNull();
    expect(section.querySelector(".markdown-article-body strong")!.textContent).toBe("goals");
    const links = [...section.querySelectorAll<HTMLAnchorElement>(".markdown-article-body a")];
    expect(links.find((link) => link.textContent === "usage")).toMatchObject({ href: "https://github.com/o/r/blob/HEAD/docs/usage.md", target: "_blank" });
    expect(links.some((link) => link.textContent === "install" || link.textContent === "bad")).toBe(false);
    expect(section.textContent).toContain("install");
    const images = [...section.querySelectorAll<HTMLImageElement>(".markdown-article-body img")];
    expect(images.map((image) => image.getAttribute("src"))).toEqual(["https://raw.githubusercontent.com/o/r/HEAD/shot.png"]);
    expect(images[0]!.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(section.querySelector("script")).toBeNull();
    expect(section.querySelector(".code-header")!.textContent).toContain("sh");
    expect(section.querySelector(".code-body code")!.textContent).toBe("npm i pi-goal");
    expect(section.querySelector(".markdown-article-end")!.textContent).toContain("Read all of it on GitHub");
  });
  it("shows no README section when a package has none, and never reads one for a missing package", async () => {
    selected = "package:pi-goal"; await render();
    expect(document.querySelector(".markdown-article")).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    readmeReads = [];
    selected = "package:gone"; await render();
    expect(readmeReads).toEqual([]);
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
  it("draws an app plugin's settings as a form: switches save at once, an address waits for Save", async () => {
    const seen: PluginCatalog[] = [];
    selected = "app:cliproxyapi-quota";
    await act(async () => root.render(<PluginsView selected={selected} api={api} runtime={runtime} onOpen={() => {}} onBack={() => {}} onCatalog={(value) => seen.push(value)} />)); await settle();
    expect(document.querySelector("h2.agent-name")!.textContent).toBe("Account meters");
    expect(button("Five-hour window").getAttribute("aria-checked")).toBe("false");
    await click("Seven-day window");
    const saved = { ...resolveAppSettings(accountMetersManifest, { five_hour: false }), seven_day: false };
    expect(calls).toEqual([{ type: "settings", id: "app:cliproxyapi-quota", settings: saved }]);
    expect(document.querySelector(".notice[data-tone=pending]")).toBeNull();
    expect(button("Save").disabled).toBe(true);
    await type("input[type=url]", "http://127.0.0.1:8317/quota");
    expect(status()).toBe("Unsaved changes");
    expect(calls).toHaveLength(1);
    await click("Save");
    expect(calls[1]).toEqual({ type: "settings", id: "app:cliproxyapi-quota", settings: { ...saved, endpoint: "http://127.0.0.1:8317/quota" } });
    expect(status()).toBe("Saved");
    expect(seen.at(-1)!.plugins.find((entry) => entry.id === "app:cliproxyapi-quota")!.settings).toMatchObject({ seven_day: false, endpoint: "http://127.0.0.1:8317/quota" });
  });
  it("edits the model, sensitivity and optional gateway address with existing settings controls", async () => {
    const settings = resolveAppSettings(decisionHintsManifest, undefined);
    catalog.plugins.push({ id: "app:decision-hints", kind: "app", name: "Decision hints", source: "Forgerie", description: decisionHintsManifest.description,
      enabled: false, settings, fields: [...decisionHintsManifest.settings] });
    selected = "app:decision-hints"; await render();
    expect(button("Load Decision hints").getAttribute("aria-checked")).toBe("false");
    expect(document.body.textContent).toContain("turn replies and commands leave this machine");
    await type('input[aria-label="Model"]', "chosen");
    const choice = document.querySelector<HTMLSelectElement>('select[aria-label="Sensitivity"]')!;
    await act(async () => { choice.value = "high"; choice.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(calls).toEqual([]); expect(button("Save").disabled).toBe(false);
    await click("Save");
    expect(calls[0]).toEqual({ type: "settings", id: "app:decision-hints", settings: { ...settings, model: "chosen", sensitivity: "high" } });
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Gateway address"]')!.required).toBe(false);
    expect(document.querySelector<HTMLInputElement>("input[type=password]")!.value).toBe("");
    await click("Load Decision hints");
    expect(calls[1]).toEqual({ type: "toggle", id: "app:decision-hints", enabled: true });
  });
  it("shows a read failure and retries", async () => {
    let fail = true;
    api = { ...api, list: async () => { if (fail) throw new Error("sessiond is unavailable"); return catalog; } };
    await render(); expect(document.body.textContent).toContain("sessiond is unavailable");
    fail = false; await click("Retry"); expect(document.body.textContent).toContain("Pi packages");
  });
});

describe("the gateway key's presence", () => {
  const hints = () => ({ id: "app:decision-hints", kind: "app" as const, name: "Decision hints", source: "Forgerie", description: decisionHintsManifest.description,
    enabled: true, settings: resolveAppSettings(decisionHintsManifest, undefined), fields: [...decisionHintsManifest.settings] });
  const field = () => [...document.querySelectorAll(".agent-field")].find((node) => node.querySelector(".agent-field-label")?.textContent === "Gateway key");
  it("shows nothing new for a plugin without a gateway key, and reads nothing", async () => {
    selected = "app:cliproxyapi-quota"; await render();
    expect(field()).toBeUndefined();
    expect(document.body.textContent).not.toContain("DECISION_GATEWAY_API_KEY");
    expect(keyReads).toBe(0);
  });
  it("says the key is present under the gateway address, never the key", async () => {
    catalog.plugins.push(hints()); selected = "app:decision-hints"; await render();
    expect(field()?.querySelector("[role=status]")?.textContent).toBe("Set here");
    expect(field()?.previousElementSibling?.querySelector(".agent-field-label")?.textContent).toBe("Gateway address");
    expect(field()?.textContent).not.toContain("DECISION_GATEWAY_API_KEY");
    expect(document.querySelector<HTMLInputElement>("input[type=password]")!.value).toBe("");
  });
  it("offers a write-only input for a missing key", async () => {
    gatewayKey = { keyPresent: false, source: "none" }; catalog.plugins.push(hints()); selected = "app:decision-hints"; await render();
    expect(field()?.querySelector("[role=status]")?.textContent).toBe("Not set");
    expect(field()?.querySelector(".agent-field-hint")?.textContent).toBe("Forgerie never shows the saved key. Changes apply to the next gateway request.");
  });
  it("says unknown when sessiond does not answer", async () => {
    runtimeFails = true; catalog.plugins.push(hints()); selected = "app:decision-hints"; await render();
    expect(field()?.querySelector("[role=status]")?.textContent).toBe("Unknown");
  });
});

describe("the runtime read", () => {
  const sessiond = (extra: object) => ({ component: "sessiond", label: "Session daemon", available: true, capabilities: [], ...extra });
  const response = (body: unknown, ok = true) => async () => new Response(JSON.stringify(body), { status: ok ? 200 : 503 });
  const runtimeOf = (decisionHints?: object, available = true) => ({ packageName: "forgerie", generatedAt: "2026-10-14T12:00:00Z", capabilities: [],
    components: { web: { component: "web", label: "Web/UI", available: true, capabilities: [] }, sessiond: sessiond({ available, ...(decisionHints ? { decisionHints } : {}) }) } });
  it("reads only the key's presence from sessiond's status", async () => {
    expect(await createRuntimeApi(response(runtimeOf({ keyPresent: true, source: "settings" }))).gatewayKey()).toEqual({ keyPresent: true, source: "settings" });
    expect(await createRuntimeApi(response(runtimeOf({ keyPresent: false, source: "none" }))).gatewayKey()).toEqual({ keyPresent: false, source: "none" });
    expect(await createRuntimeApi(response(runtimeOf())).gatewayKey()).toBe("unknown");
    expect(await createRuntimeApi(response(runtimeOf({ keyPresent: true, source: "environment" }, false))).gatewayKey()).toBe("unknown");
    expect(await createRuntimeApi(response({ error: "down" }, false)).gatewayKey()).toBe("unknown");
  });
});
