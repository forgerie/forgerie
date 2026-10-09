// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_PLUGIN_MANIFESTS } from "@shared/appPluginManifests";
import type { AppPlugin, AppPluginProps } from "./appPlugin";
import { createAppPluginStore, statesFromCatalog, type AppPluginStateMap } from "./appPluginStates";
import { APP_PLUGINS, PickerShelves } from "./PickerShelves.binding";

let root: Root;
const manifest = { id: "probe", name: "Probe", description: "", settings: [] };
const probe: AppPlugin = { manifest, pickerShelf: ({ settings }: AppPluginProps) => <p className="probe">{JSON.stringify(settings)}</p> };
const broken: AppPlugin = { manifest: { ...manifest, id: "broken", name: "Broken" }, pickerShelf: () => { throw new Error("no data"); } };
const settle = () => act(async () => { for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0)); });
function storeWith(read: () => Promise<AppPluginStateMap>) { return createAppPluginStore({ read }); }
async function render(plugins: readonly AppPlugin[], store: ReturnType<typeof storeWith>) {
  await act(async () => root.render(<PickerShelves plugins={plugins} store={store} />));
  await settle();
}
const catalog = (enabled: boolean) => ({ profileDir: "", configPath: "", home: "", revision: "v", restartRequired: false, restartAvailable: true, plugins: [
  { id: "app:probe", kind: "app" as const, name: "Probe", source: "Forgerie", description: "", enabled, settings: { endpoint: "https://x.example/" } },
] });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("the session list's plugin slot", () => {
  it("draws nothing until the states are read, then only plugins that are on, and follows a Settings change", async () => {
    let resolve: (value: AppPluginStateMap) => void = () => {};
    const store = storeWith(() => new Promise((done) => { resolve = done; }));
    await render([probe], store);
    expect(document.querySelector(".probe")).toBeNull();
    await act(async () => resolve(new Map([["probe", { enabled: true, settings: { five_hour: false } }]]))); await settle();
    expect(document.querySelector(".probe")!.textContent).toBe('{"five_hour":false}');
    await act(async () => store.apply(catalog(false)));
    expect(document.querySelector(".probe")).toBeNull();
  });
  it("keeps the list working when a plugin throws, and names the plugin", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await render([broken, probe], storeWith(async () => new Map([["broken", { enabled: true, settings: {} }], ["probe", { enabled: true, settings: {} }]])));
    expect(document.querySelector(".alert-card")!.textContent).toBe("Broken stoppedno data");
    expect(document.querySelector(".probe")).not.toBeNull();
  });
  it("leaves plugins hidden when the states cannot be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await render([probe], storeWith(() => Promise.reject(new Error("offline"))));
    expect(document.querySelector(".probe")).toBeNull();
  });
  it("reads the app plugins' states out of a Settings catalog", () => {
    expect([...statesFromCatalog(catalog(false))]).toEqual([["probe", { enabled: false, settings: { endpoint: "https://x.example/" } }]]);
  });
  it("registers one interface for every manifest the server lists", () => {
    expect(APP_PLUGINS.map((plugin) => plugin.manifest)).toEqual([...APP_PLUGIN_MANIFESTS]);
  });
});
