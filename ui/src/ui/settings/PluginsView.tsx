import { SettingsInput } from "./SettingsInput";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronLeftIcon, EllipsisIcon, PlusIcon, RefreshCwIcon, RotateCwIcon, Trash2Icon, XIcon } from "lucide-react";
import { createPluginsApi, createRuntimeApi, GATEWAY_KEY_PLUGIN, type GatewayKey, type PluginsApi, type RuntimeApi } from "../../plugins/pluginsApi";
import type { ManagedPlugin, PluginCatalog, PluginChange } from "@shared/pluginsContract";
import type { AppSettingDef, AppSettings } from "@shared/appPlugins";
import { SettingsFrame } from "./SettingsFrame";
import { SettingsRow } from "./SettingsRow";
import { SettingsField } from "./SettingsField";
import { SettingsToggle } from "./SettingsToggle";
import { ConfirmDialog } from "../ConfirmDialog";
import { useMenu } from "../useMenu";
import { PluginReadme, type ReadmeLoad } from "../../plugins/PluginReadme";
import "./settings.css";
import "./plugins.css";

const liveApi = createPluginsApi((path, init) => fetch(path, init));
const liveRuntime = createRuntimeApi((path, init) => fetch(path, init));
/** The gateway key's presence in words. The key itself never reaches the browser. */
const KEY_WORDS: Record<GatewayKey | "checking", { value: string; hint?: ReactNode }> = {
  checking: { value: "Checking…" },
  present: { value: "Present", hint: "Sessiond has it. Forgerie never shows the key." },
  missing: { value: "Not set", hint: <>Set <code>DECISION_GATEWAY_API_KEY</code> in sessiond's environment, then restart sessiond.</> },
  unknown: { value: "Unknown", hint: "Sessiond did not report it. Check that sessiond is running." },
};
type Load = { type: "loading" } | { type: "ready"; value: PluginCatalog } | { type: "failed"; message: string };
/** Progress and outcome words for the header, e.g. "Installing…" then "Installed". */
type Phase = { type: "idle" } | { type: "busy"; label: string } | { type: "done"; label: string } | { type: "failed"; message: string };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const WORDS: Record<PluginChange["type"], [busy: string, done: string]> = {
  add: ["Installing…", "Installed"], toggle: ["Saving…", "Saved"], settings: ["Saving…", "Saved"], remove: ["Removing…", "Removed"],
};

/** A path under the home folder, written from `~`. */
export const tildify = (path: string, home: string) => home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
/** An npm scope says who published a package, not what it is. The source keeps it. */
export const plainName = (plugin: ManagedPlugin) => plugin.kind === "package" && /^@[^/]+\//u.test(plugin.name) ? plugin.name.slice(plugin.name.indexOf("/") + 1) : plugin.name;
function origin(plugin: ManagedPlugin, home: string): string {
  if (plugin.kind === "builtin") return "Part of Forgerie";
  if (plugin.kind === "app") return "Bundled with Forgerie";
  return tildify(plugin.source, home);
}

/** Binding: one data edge for the list, selected plugin, mutations, and confirmations. */
export function PluginsView({ selected, onOpen, onBack, onClose, onCatalog, api = liveApi, runtime = liveRuntime }: {
  selected?: string | undefined; onOpen: (id: string | undefined) => void; onBack: () => void; onClose?: (() => void) | undefined; api?: PluginsApi;
  /** Reads whether sessiond has a plugin's gateway key, for the plugin that needs one. */
  runtime?: RuntimeApi;
  /** Every catalog this page reads or saves, so the app's own plugins follow a change at once. */
  onCatalog?: ((catalog: PluginCatalog) => void) | undefined;
}) {
  const [load, setLoad] = useState<Load>({ type: "loading" });
  const [phase, setPhase] = useState<Phase>({ type: "idle" });
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [source, setSource] = useState("");
  const menu = useMenu();
  const catalog = load.type === "ready" ? load.value : undefined;
  useEffect(() => { if (catalog) onCatalog?.(catalog); }, [catalog, onCatalog]);
  const plugin = catalog?.plugins.find((entry) => entry.id === selected);
  // An app plugin declares its settings; the catalog carries them, so this page never imports a plugin.
  const fields = plugin?.kind === "app" ? plugin.fields ?? [] : undefined;
  // Typed text for an app plugin's address settings. Switches save at once; text waits for Save.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setPhase({ type: "busy", label: "Reading…" });
    try { const value = await api.list(signal); if (!signal?.aborted) { setLoad({ type: "ready", value }); setPhase({ type: "idle" }); } }
    catch (error) { if (!signal?.aborted) setPhase({ type: "failed", message: errorText(error) }); }
  }, [api]);
  useEffect(() => {
    const controller = new AbortController();
    api.list(controller.signal).then((value) => { if (!controller.signal.aborted) setLoad({ type: "ready", value }); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setLoad({ type: "failed", message: errorText(error) }); });
    return () => controller.abort();
  }, [api]);
  // A package's README, read once per opened package. Other kinds have no folder of their own to read.
  const readmeId = plugin?.kind === "package" && plugin.installed !== false ? plugin.id : undefined;
  const [readme, setReadme] = useState<{ id: string; load: ReadmeLoad } | undefined>();
  useEffect(() => {
    if (!readmeId) return;
    const controller = new AbortController();
    setReadme({ id: readmeId, load: { type: "loading" } });
    api.readme(readmeId, controller.signal).then((value) => { if (!controller.signal.aborted) setReadme({ id: readmeId, load: { type: "ready", value } }); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setReadme({ id: readmeId, load: { type: "failed", message: errorText(error) } }); });
    return () => controller.abort();
  }, [api, readmeId]);
  // Whether sessiond has the gateway key, read each time its plugin opens. Only presence is read.
  const keyed = plugin?.id === GATEWAY_KEY_PLUGIN;
  const [gatewayKey, setGatewayKey] = useState<GatewayKey | "checking">("checking");
  useEffect(() => {
    if (!keyed) return;
    const controller = new AbortController();
    setGatewayKey("checking");
    runtime.gatewayKey(controller.signal).then((value) => { if (!controller.signal.aborted) setGatewayKey(value); })
      .catch(() => { if (!controller.signal.aborted) setGatewayKey("unknown"); });
    return () => controller.abort();
  }, [runtime, keyed]);
  const keyField = keyed ? <SettingsField key="gateway-key" label="Gateway key" hint={KEY_WORDS[gatewayKey].hint}>
    <span className="plugin-value">{KEY_WORDS[gatewayKey].value}</span></SettingsField> : null;
  const { setOpen: setMenuOpen } = menu;
  useEffect(() => { setMenuOpen(false); setRemoving(false); setTyped({}); }, [selected, setMenuOpen]);
  const busy = phase.type === "busy";
  const appValues = plugin?.kind === "app" ? (plugin.settings ?? {}) as AppSettings : undefined;
  const typedDirty = appValues !== undefined && Object.entries(typed).some(([id, text]) => text !== appValues[id]);
  const dirty = typedDirty;
  async function change(change: PluginChange, revision = catalog?.revision) {
    if (!revision || busy) return;
    const [busyWord, doneWord] = WORDS[change.type];
    setPhase({ type: "busy", label: busyWord });
    try {
      const value = await api.change(revision, change);
      setLoad({ type: "ready", value });
      setPhase({ type: "done", label: doneWord });
      if (change.type === "settings" && plugin?.kind === "app") setTyped({});
      if (change.type === "remove") onOpen(undefined);
      if (change.type === "add") { setSource(""); onOpen(undefined); }
    } catch (error) { setPhase({ type: "failed", message: errorText(error) }); }
  }
  async function restart() {
    if (!catalog || busy) return;
    setPhase({ type: "busy", label: "Restarting…" });
    try { const value = await api.restart(catalog.revision); setLoad({ type: "ready", value }); setPhase({ type: "done", label: "Restarted" }); }
    catch (error) { setPhase({ type: "failed", message: errorText(error) }); }
  }
  const discard = () => {
    setTyped({});
    setPhase({ type: "idle" });
  };
  const save = () => {
    if (plugin?.kind === "app" && appValues && typedDirty) void change({ type: "settings", id: plugin.id, settings: { ...appValues, ...typed } });
  };
  // A switch saves at once, with the values already saved: typed text stays a draft until Save.
  const setSwitch = (id: string, value: boolean) => { if (plugin && appValues) void change({ type: "settings", id: plugin.id, settings: { ...appValues, [id]: value } }); };
  const adding = selected === "new";
  const title = adding ? "Install package" : plugin ? plainName(plugin) : "Plugins";
  const status = busy ? phase.label : dirty ? "Unsaved changes" : phase.type === "done" ? phase.label : undefined;

  const back = <button type="button" className="settings-back" aria-label={selected ? "Back to Plugins" : "Back to Settings"}
    onClick={() => { if (selected) onOpen(undefined); else onBack(); }}><ChevronLeftIcon aria-hidden size={16} />{selected ? "Plugins" : "Settings"}</button>;
  const primary = adding ? <button type="submit" form="plugin-install" className="settings-primary" disabled={busy || !catalog || !source.trim()}>Install</button>
    : !selected ? <button type="button" className="settings-primary" disabled={busy || !catalog} onClick={() => onOpen("new")}><PlusIcon aria-hidden size={14} />Install package</button>
    : fields?.some((def) => def.type !== "boolean") ? <button type="submit" form="app-plugin-settings" className="settings-primary"
      disabled={busy || !typedDirty || fields?.some((def) => def.type !== "boolean" && !(def.type === "url" && def.optional) && !(typed[def.id] ?? String(appValues?.[def.id] ?? def.default)).trim())}>Save</button>
    : null;
  const removable = plugin?.kind === "package";
  // Rare commands wait one tap away, as on Agents and Backlog. Remove asks twice, in place.
  const commands = adding ? null : <div className="settings-menu-anchor" ref={menu.anchor}>
    <button type="button" className="picker-icon" aria-label="Plugin commands" title="More commands" aria-haspopup="menu" aria-expanded={menu.open}
      onClick={() => { menu.setOpen(!menu.open); setRemoving(false); }}><EllipsisIcon aria-hidden size={16} /></button>
    {menu.open ? <div className="picker-menu" role="menu" aria-label="Plugin commands">
      {dirty ? <button type="button" role="menuitem" onClick={() => { menu.setOpen(false); setTyped({}); discard(); }}><XIcon aria-hidden />Discard changes</button> : null}
      {removable ? <button type="button" role="menuitem" data-tone="danger" disabled={busy}
        onClick={() => { if (removing) { menu.setOpen(false); void change({ type: "remove", id: plugin.id }); } else setRemoving(true); }}>
        <Trash2Icon aria-hidden />{removing ? "Remove? Its code stays on disk" : "Remove package"}</button> : null}
      {dirty || removable ? <div className="picker-menu-separator" role="separator" /> : null}
      <button type="button" role="menuitem" disabled={busy} onClick={() => { menu.setOpen(false); void refresh(); }}><RefreshCwIcon aria-hidden />Read plugins again</button>
      <button type="button" role="menuitem" disabled={busy || !catalog?.restartAvailable} onClick={() => { menu.setOpen(false); setConfirmRestart(true); }}>
        <RotateCwIcon aria-hidden />Restart Forgerie…{catalog && !catalog.restartAvailable ? <small>Unavailable</small> : null}</button>
    </div> : null}
  </div>;
  const close = onClose ? <button type="button" className="picker-icon" aria-label="Close settings" title="Close settings" onClick={onClose}><XIcon aria-hidden size={16} /></button> : null;
  const notice = catalog?.restartRequired ? catalog.restartAvailable
    ? <><p>Restart Forgerie to apply your changes. Restarting stops running agents.</p>
      <button type="button" disabled={busy} onClick={() => setConfirmRestart(true)}>Restart…</button></>
    : <p>Restart Forgerie on its host to apply your changes: <code>systemctl --user restart forgerie-web.service forgerie-sessiond.service</code></p>
    : undefined;

  return <SettingsFrame back={back} title={title} status={status} actions={<>{primary}{commands}{close}</>} notice={notice}
    error={load.type === "failed" ? load.message : phase.type === "failed" ? phase.message : undefined}
    recovery={<button type="button" disabled={busy} onClick={() => void refresh()}>Retry</button>}>
    {load.type === "loading" ? <p className="settings-hint" role="status">Reading plugins…</p> : null}
    {catalog && !selected ? <PluginList catalog={catalog} onOpen={onOpen} /> : null}
    {catalog && adding ? <form id="plugin-install" className="plugin-form" onSubmit={(event) => { event.preventDefault(); void change({ type: "add", source: source.trim() }); }}>
      <p className="settings-lede">Forgerie installs the package into <code>{tildify(catalog.profileDir, catalog.home)}</code>. Packages run with your user permissions, so install only code you trust.</p>
      <label htmlFor="plugin-source">Package source</label>
      <input id="plugin-source" value={source} onChange={(event) => setSource(event.target.value)} placeholder="npm:@scope/name" required disabled={busy}
        autoComplete="off" autoCapitalize="off" spellCheck={false} aria-describedby="plugin-source-hint" />
      <p id="plugin-source-hint" className="settings-hint">An npm package such as <code>npm:@scope/name</code>, a Git URL, or the path to a local folder.</p>
    </form> : null}
    {catalog && plugin ? <PluginDetail plugin={plugin} home={catalog.home} busy={busy}
      onToggle={(enabled) => void change({ type: "toggle", id: plugin.id, enabled })}>
      {fields && fields.length > 0 && appValues ? <form id="app-plugin-settings" className="plugin-settings" onSubmit={(event) => { event.preventDefault(); save(); }}>
        <h2 className="agent-section">Settings</h2>
        <div className="agent-properties plugin-fields">{fields.flatMap((def) => {
          const field = fieldOf(def, appValues, typed, busy, setSwitch, (id, text) => setTyped((current) => ({ ...current, [id]: text })));
          // The key's presence sits under the gateway address it goes with.
          return def.type === "url" && keyField ? [field, keyField] : [field];
        })}</div>
      </form> : null}
      {readmeId && readme?.id === readmeId ? <PluginReadme load={readme.load} name={plainName(plugin)} packageName={plugin.name} /> : null}
    </PluginDetail> : null}
    {catalog && selected && !adding && !plugin ? <p className="settings-hint">This plugin is no longer listed. Go back to Plugins.</p> : null}
    {confirmRestart ? <ConfirmDialog title="Restart Forgerie?" icon={<RotateCwIcon size={16} />} confirmLabel="Stop runs and restart"
      onCancel={() => setConfirmRestart(false)} onConfirm={() => { setConfirmRestart(false); void restart(); }}>
      <p className="wt-lead">Restarting stops every running agent.</p>
      <p className="wt-note">Open clients reconnect when Forgerie is back. Saved sessions are kept.</p>
    </ConfirmDialog> : null}
  </SettingsFrame>;
}

/** Shape: plugin groups over the shared settings row. A row speaks only when something is unusual. */
export function PluginList({ catalog, onOpen }: { catalog: PluginCatalog; onOpen: (id: string) => void }) {
  const { home, profileDir } = catalog;
  const extensionsDir = `${profileDir}/extensions`;
  const groups: { kind: ManagedPlugin["kind"]; title: string; empty: string; where?: string }[] = [
    { kind: "package", title: "Pi packages", empty: "No Pi packages yet. Install one from npm, Git, or a local folder.", where: profileDir },
    { kind: "extension", title: "Pi extensions", empty: "No extension files in this profile.", where: extensionsDir },
    { kind: "app", title: "Forgerie plugins", empty: "", where: catalog.configPath },
    { kind: "builtin", title: "Built in", empty: "" },
  ];
  const second = (entry: ManagedPlugin) => entry.description
    || (entry.kind === "package" ? origin(entry, home)
      : entry.kind === "extension" && !entry.source.startsWith(`${extensionsDir}/`) ? tildify(entry.source, home) : undefined);
  return <>
    <p className="settings-lede">Plugins run with your user permissions. Turn on only code you trust.</p>
    {groups.map((group) => {
      const entries = catalog.plugins.filter((entry) => entry.kind === group.kind);
      if (entries.length === 0 && !group.empty) return null;
      return <section className="agent-group" key={group.kind} aria-label={group.title}>
        <h2 className="agent-group-label">{group.title}</h2>
        {entries.length === 0 ? <p className="settings-hint plugin-empty">{group.empty}</p>
          : <ul className="agent-list">{entries.map((entry) => <SettingsRow key={entry.id} name={plainName(entry)} meta={entry.version}
            description={second(entry)} dimmed={!entry.enabled} onOpen={() => onOpen(entry.id)} flags={<>
              {entry.enabled ? null : <span>Turned off</span>}
              {entry.installed === false ? <span data-tone="error">Not installed</span> : null}
              {entry.filtered ? <span>Some resources only</span> : null}
            </>} />)}</ul>}
        {group.where ? <p className="agent-group-where">{group.kind === "extension" ? "Files in" : "Saved in"} <code>{tildify(group.where, home)}</code></p> : null}
      </section>;
    })}
  </>;
}

/** Shape: one plugin as a document, like an agent: name, what it does, then its properties. */
function PluginDetail({ plugin, home, busy, onToggle, children }: {
  plugin: ManagedPlugin; home: string; busy: boolean;
  onToggle: (enabled: boolean) => void;
  /** A form of the plugin's own, drawn after its properties. */
  children?: ReactNode;
}) {
  const name = plainName(plugin);
  const standfirst = plugin.description || (plugin.kind === "extension" ? "A Pi extension file." : "A Pi package.");
  const load = plugin.kind === "app" ? "Turned on" : "Load in sessions";
  const hint = plugin.kind === "builtin" ? "Part of Forgerie. You cannot turn it off here."
    : plugin.kind === "app" ? (plugin.enabled ? "Enabled. Changes apply at once." : "Disabled. Its settings are kept.")
    : plugin.kind === "extension" ? (plugin.enabled ? "Sessions load this file." : "Sessions skip this file. The file stays where it is.")
    : plugin.enabled ? "Sessions load this package's tools, skills, and prompts." : "Kept in the list, but not loaded. Turn it on to load it again.";
  return <article className="agent-editor plugin-detail">
    <h2 className="agent-name">{name}</h2>
    <p className="settings-standfirst">{standfirst}</p>
    <div className="agent-properties">
      <SettingsField label={load} hint={hint}>
        <SettingsToggle label={`Load ${name}`} checked={plugin.enabled} disabled={busy || plugin.kind === "builtin"} onChange={onToggle} />
      </SettingsField>
      {plugin.kind === "package" && plugin.installed === false ? <SettingsField label="Status" hint="Pi skips a package it cannot find. Install it again, or remove it.">
        <span className="plugin-value" data-tone="error">Not installed</span></SettingsField> : null}
      {plugin.version ? <SettingsField label="Version"><span className="plugin-value">{plugin.version}</span></SettingsField> : null}
      {plugin.name !== name ? <SettingsField label="Package"><code className="plugin-path">{plugin.name}</code></SettingsField> : null}
      {plugin.kind === "builtin" ? null : <SettingsField label="Source">{plugin.kind === "app" && !plugin.source.includes("/")
        ? <span className="plugin-value">{origin(plugin, home)}</span> : <code className="plugin-path">{origin(plugin, home)}</code>}</SettingsField>}
      {plugin.filtered ? <SettingsField label="Resources"><span className="plugin-value">Some resources only, as listed in Forgerie's Pi settings</span></SettingsField> : null}
    </div>
    {children}
  </article>;
}

/**
 * One field of an app plugin's settings. A switch saves at once, as every
 * switch in Settings does. An address is typed, so it waits for Save or Enter.
 */
function fieldOf(def: AppSettingDef, values: AppSettings, typed: Readonly<Record<string, string>>, busy: boolean,
  onSwitch: (id: string, value: boolean) => void, onType: (id: string, text: string) => void) {
  return <SettingsField key={def.id} label={def.label} hint={def.description}>
    {def.type === "boolean" ? <SettingsToggle label={def.label} checked={values[def.id] === true} disabled={busy} onChange={(value) => onSwitch(def.id, value)} />
      : <SettingsInput type={def.type === "url" ? "url" : "text"} choices={def.type === "choice" ? def.choices : undefined} label={def.label} value={typed[def.id] ?? String(values[def.id] ?? def.default)} disabled={busy} required={!(def.type === "url" && def.optional)} placeholder={def.default} onChange={(value) => onType(def.id, value)} />}
  </SettingsField>;
}
