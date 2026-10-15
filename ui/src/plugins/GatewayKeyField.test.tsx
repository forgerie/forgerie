// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SecretSettingsField } from "../ui/SecretSettingsField";
import { gatewayKeyView } from "./pluginsApi";
import type { GatewayKey, RuntimeApi } from "./pluginsApi";

let root: Root;
let value: GatewayKey;
let calls: unknown[];
let fail: boolean;
const secret = "DISTINCTIVE-ui-private-gateway-October15";
const runtime: RuntimeApi = {
  gatewayKey: async () => value,
  setGatewayKey: async (revision, apiKey) => { calls.push({ revision, apiKey }); if (fail) throw new Error(secret); return { keyPresent: true, source: "settings" }; },
  clearGatewayKey: async revision => { calls.push({ revision }); return { keyPresent: false, source: "none" }; },
};
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const input = () => document.querySelector<HTMLInputElement>('input[type="password"]')!;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === label.replace(" gateway key", ""))!;
async function render(busy = false) { await act(async () => root.render(<SecretSettingsField label="Gateway key" read={runtime.gatewayKey} describe={gatewayKeyView} busy={busy}
    write={key => runtime.setGatewayKey("catalog-revision", key)} clear={() => runtime.clearGatewayKey("catalog-revision")}
    failure={clear => `Could not ${clear ? "remove" : "save"} the gateway key. Reload Settings and try again.`} />)); await settle(); }
async function type(text: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), text); input().dispatchEvent(new Event("input", { bubbles: true })); });
}
async function click(label: string) { await act(async () => button(label).click()); await settle(); }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
  value = { keyPresent: false, source: "none" }; calls = []; fail = false;
  localStorage.clear(); sessionStorage.clear();
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("Gateway key settings", () => {
  it("keeps the password empty, saves separately, clears it, replaces and removes without displaying the key", async () => {
    await render();
    expect(input().value).toBe(""); expect(document.body.textContent).toContain("Not set");
    expect(button("Save gateway key").disabled).toBe(true); expect(button("Remove gateway key").disabled).toBe(true);
    await type(secret); await click("Save gateway key");
    expect(calls).toEqual([{ revision: "catalog-revision", apiKey: secret }]);
    expect(input().value).toBe(""); expect(document.body.textContent).toContain("Set here");
    expect(document.body.innerHTML).not.toContain(secret);
    expect(button("Replace gateway key").textContent).toBe("Replace");
    await type("replacement"); await click("Replace gateway key");
    expect(input().value).toBe("");
    await click("Remove gateway key");
    expect(calls.at(-1)).toEqual({ revision: "catalog-revision" });
    expect(document.body.textContent).toContain("Not set");
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  });
  it("disables environment-owned keys with a one-line reason and never prefills them", async () => {
    value = { keyPresent: true, source: "environment" }; await render();
    expect(input().value).toBe(""); expect(input().disabled).toBe(true);
    expect(button("Replace gateway key").disabled).toBe(true); expect(button("Remove gateway key").disabled).toBe(true);
    expect(document.body.textContent).toContain("Set by DECISION_GATEWAY_API_KEY");
    expect(document.body.textContent).toContain("Settings cannot replace or remove an environment key.");
    await click("Remove gateway key"); expect(calls).toEqual([]);
  });
  it("keeps controls disabled when sessiond is unknown or other settings are saving", async () => {
    value = "unknown"; await render(); expect(input().disabled).toBe(true);
    expect(document.body.textContent).toContain("Unknown");
    await act(async () => root.unmount()); root = createRoot(document.body.appendChild(document.createElement("div")));
    value = { keyPresent: true, source: "settings" }; await render(true);
    expect(input().value).toBe(""); expect(input().disabled).toBe(true);
    expect(button("Remove gateway key").disabled).toBe(true);
  });
  it("does not put rejected secret-bearing errors in the UI and clears failed drafts", async () => {
    await render(); fail = true; await type(secret); await click("Save gateway key");
    expect(document.body.innerHTML).not.toContain(secret); expect(input().value).toBe("");
    expect(document.body.textContent).toContain("Could not save the gateway key");
  });
  it("Enter saves the key, not its surrounding plugin settings form", async () => {
    await render(); await type(secret);
    await act(async () => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    await settle(); expect(calls).toEqual([{ revision: "catalog-revision", apiKey: secret }]);
    expect(input().value).toBe("");
  });
});
