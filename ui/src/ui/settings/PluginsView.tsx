import { useCallback, useEffect, useState } from "react";
import { ChevronLeftIcon, PlusIcon, RefreshCwIcon, Trash2Icon, XIcon } from "lucide-react";
import { z } from "zod";
import { createPluginsApi, type ManagedPlugin, type PluginCatalog, type PluginChange, type PluginsApi } from "../../plugins/pluginsApi";
import { SettingsFrame } from "./SettingsFrame";
import { SettingsRow } from "./SettingsRow";
import { SettingsToggle } from "./SettingsToggle";
import { ConfirmDialog } from "../ConfirmDialog";
import "./settings.css";
import "./plugins.css";

const liveApi = createPluginsApi((path, init) => fetch(path, init));
type Load = { type: "loading" } | { type: "ready"; value: PluginCatalog } | { type: "failed"; message: string };
type Phase = { type: "idle" } | { type: "saving" } | { type: "failed"; message: string } | { type: "saved"; message: string };
type Decision = { type: "restart" } | { type: "remove"; plugin: ManagedPlugin };
type Draft = { text: string; baseRevision: string; baseText: string };
// Settings can contain credentials. Never put these drafts in localStorage.
const drafts = new Map<string, Draft>();
const objectSchema = z.record(z.string(), z.unknown());
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const settingsText = (plugin: ManagedPlugin) => JSON.stringify(plugin.settings ?? {}, null, 2);
const parseSettings = (text: string): Record<string, unknown> | undefined => {
  try { return objectSchema.parse(JSON.parse(text)); } catch { return undefined; }
};

/** Binding: one data edge for the list, selected plugin, mutations, and confirmations. */
export function PluginsView({ selected, onOpen, onBack, onClose, api = liveApi }: {
  selected?: string | undefined; onOpen: (id: string | undefined) => void; onBack: () => void; onClose?: (() => void) | undefined; api?: PluginsApi;
}) {
  const [load, setLoad] = useState<Load>({ type: "loading" });
  const [phase, setPhase] = useState<Phase>({ type: "idle" });
  const [decision, setDecision] = useState<Decision>();
  const [draft, setDraft] = useState<Draft>();
  const [source, setSource] = useState("");
  const catalog = load.type === "ready" ? load.value : undefined;
  const plugin = catalog?.plugins.find((entry) => entry.id === selected);
  const key = catalog && plugin ? `${catalog.profileDir}:${plugin.id}` : undefined;
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try { const value = await api.list(signal); if (!signal?.aborted) { setLoad({ type: "ready", value }); setPhase({ type: "idle" }); } }
    catch (error) { if (!signal?.aborted) setPhase({ type: "failed", message: errorText(error) }); }
  }, [api]);
  useEffect(() => {
    const controller = new AbortController();
    api.list(controller.signal).then((value) => { if (!controller.signal.aborted) setLoad({ type: "ready", value }); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setLoad({ type: "failed", message: errorText(error) }); });
    return () => controller.abort();
  }, [api]);
  useEffect(() => {
    if (!key || !plugin || !catalog) { setDraft(undefined); return; }
    // A stored dirty draft keeps its old revision. A clean detail follows the new catalog.
    setDraft(drafts.get(key) ?? { text: settingsText(plugin), baseText: settingsText(plugin), baseRevision: catalog.revision });
  }, [key, plugin, catalog]);
  const busy = phase.type === "saving";
  const draftSettings = draft ? parseSettings(draft.text) : undefined;
  async function change(change: PluginChange, revision = catalog?.revision) {
    if (!revision || busy) return;
    setPhase({ type: "saving" });
    try {
      const value = await api.change(revision, change);
      setLoad({ type: "ready", value });
      setPhase({ type: "saved", message: "Saved. Restart services to apply the change." });
      if (change.type === "settings" && key) {
        drafts.delete(key);
        const text = JSON.stringify(change.settings, null, 2);
        setDraft({ text, baseText: text, baseRevision: value.revision });
      }
      if (change.type === "remove") onOpen(undefined);
      if (change.type === "add") { setSource(""); onOpen(undefined); }
    } catch (error) { setPhase({ type: "failed", message: errorText(error) }); }
  }
  async function restart() {
    if (!catalog || busy) return;
    setPhase({ type: "saving" });
    try { const value = await api.restart(catalog.revision); setLoad({ type: "ready", value }); setPhase({ type: "saved", message: "Both Forgerie services restarted." }); }
    catch (error) { setPhase({ type: "failed", message: errorText(error) }); }
  }
  function edit(text: string) {
    if (!draft || !key) return;
    const next = { ...draft, text };
    setDraft(next);
    if (next.text === next.baseText) drafts.delete(key); else drafts.set(key, next);
  }
  const discard = () => {
    if (!plugin || !catalog || !key) return;
    drafts.delete(key);
    setDraft({ text: settingsText(plugin), baseText: settingsText(plugin), baseRevision: catalog.revision });
    setPhase({ type: "idle" });
  };
  const back = <button type="button" className="settings-back" aria-label={selected ? "Back to Plugins" : "Back to Settings"}
    onClick={() => { if (selected) onOpen(undefined); else onBack(); }}><ChevronLeftIcon aria-hidden size={16} />{selected ? "Plugins" : "Settings"}</button>;
  const close = onClose ? <button type="button" className="picker-icon" aria-label="Close settings" onClick={onClose}><XIcon aria-hidden size={16} /></button> : null;
  const retry = <button type="button" className="plugin-button" disabled={busy} onClick={() => void refresh()}>Reload</button>;
  return <SettingsFrame back={back} title={selected === "new" ? "Add package" : plugin?.name ?? "Plugins"}
    status={busy ? "Saving…" : undefined} actions={<>
      <button type="button" className="picker-icon" aria-label="Reload plugins" disabled={busy} onClick={() => void refresh()}><RefreshCwIcon aria-hidden size={16} /></button>
      {!selected ? <button type="button" className="settings-primary" disabled={busy} onClick={() => onOpen("new")}><PlusIcon aria-hidden size={14} />Add package</button> : null}
      {selected === "new" ? <button type="submit" form="plugin-install" className="settings-primary" disabled={busy || !catalog || !source.trim()}>Install package</button> : null}
      {plugin?.kind === "forgerie" ? <button type="button" className="settings-primary" disabled={busy || !draft || draft.text === draft.baseText || !draftSettings}
        onClick={() => { if (draftSettings) void change({ type: "settings", id: plugin.id, settings: draftSettings }, draft?.baseRevision); }}>Save settings</button> : null}
      {plugin?.kind === "package" ? <button type="button" className="picker-icon" aria-label="Remove package" title="Remove package" disabled={busy}
        onClick={() => setDecision({ type: "remove", plugin })}><Trash2Icon aria-hidden size={16} /></button> : null}{close}</>}
    error={load.type === "failed" ? load.message : phase.type === "failed" ? phase.message : undefined} recovery={retry}>
    {phase.type === "saved" ? <p className="settings-hint" role="status">{phase.message}</p> : null}
    {catalog ? <div className="plugin-restart">
      <p>{catalog.restartRequired ? "Restart needed. Saved changes are not yet applied to Pi sessions." : "Pi changes apply after restart. Restart stops active runs."}</p>
      {catalog.restartAvailable ? <button type="button" className="plugin-button" disabled={busy} onClick={() => setDecision({ type: "restart" })}>Restart services</button>
        : <code>systemctl --user restart forgerie-web.service forgerie-sessiond.service</code>}
    </div> : null}
    {load.type === "loading" ? <p className="settings-hint" role="status">Reading plugins…</p> : null}
    {catalog && !selected ? <PluginList catalog={catalog} onOpen={onOpen} /> : null}
    {catalog && selected === "new" ? <form id="plugin-install" className="plugin-form" onSubmit={(event) => { event.preventDefault(); void change({ type: "add", source: source.trim() }); }}>
      <p className="settings-lede">Install a Pi package in Forgerie's profile. Packages run with your user permissions. Install only code you trust.</p>
      <label htmlFor="plugin-source">Package source</label>
      <input id="plugin-source" value={source} onChange={(event) => setSource(event.target.value)} placeholder="npm:@scope/package or /absolute/local/path" required disabled={busy} autoComplete="off" />
      <p className="settings-hint">Use an npm source, Git source, or local path. A Pi package can also supply Forgerie browser plugins.</p>
      <p className="agent-group-where">Saved in <code>{catalog.profileDir}</code></p>
    </form> : null}
    {plugin && selected !== "new" ? <PluginDetail plugin={plugin} busy={busy} draft={draft} onEdit={edit} onDiscard={discard}
      onToggle={(enabled) => void change({ type: "toggle", id: plugin.id, enabled })}
      onRemove={() => setDecision({ type: "remove", plugin })}
      onSave={(settings) => void change({ type: "settings", id: plugin.id, settings }, draft?.baseRevision)} /> : null}
    {catalog && selected && selected !== "new" && !plugin ? <p className="settings-hint">This plugin is no longer listed. Reload, or go back to Plugins.</p> : null}
    {decision ? <ConfirmDialog title={decision.type === "restart" ? "Restart Forgerie services?" : `Remove ${decision.plugin.name}?`}
      confirmLabel={decision.type === "restart" ? "Stop runs and restart" : "Remove package"} onCancel={() => setDecision(undefined)}
      onConfirm={() => { const current = decision; setDecision(undefined); if (current.type === "restart") void restart(); else void change({ type: "remove", id: current.plugin.id }); }}>
      <p>{decision.type === "restart" ? "This stops active agent runs and disconnects the original client. Saved sessions remain. Both web and sessiond restart."
        : "This removes the package from Forgerie's profile. Its code stays on disk. The global Pi profile does not change."}</p>
    </ConfirmDialog> : null}
  </SettingsFrame>;
}

/** Shape: domain grouping over the shared settings row molecule. */
export function PluginList({ catalog, onOpen }: { catalog: PluginCatalog; onOpen: (id: string) => void }) {
  const groups: { kind: ManagedPlugin["kind"]; title: string; empty: string }[] = [
    { kind: "package", title: "Pi packages", empty: "No Pi packages. Add an npm, Git, or local package." },
    { kind: "extension", title: "Pi extensions", empty: "No loose Pi extensions in this profile." },
    { kind: "forgerie", title: "Forgerie plugins", empty: "No Forgerie browser plugins were found." },
    { kind: "builtin", title: "Built in", empty: "No built-in add-ons." },
  ];
  return <>
    <p className="settings-lede">Plugins run with your user permissions. Enable only code you trust. Changes stay in Forgerie, not the global Pi profile.</p>
    {groups.map((group) => <section className="agent-group" key={group.kind} aria-label={group.title}>
      <h2 className="agent-group-label">{group.title}</h2>
      <ul className="agent-list">{catalog.plugins.filter((entry) => entry.kind === group.kind).map((entry) => <SettingsRow key={entry.id} name={entry.name}
        meta={entry.kind === "builtin" ? "Read only" : entry.enabled ? "On" : "Off"}
        description={entry.description === "Pi package" || entry.description === "Loose Pi extension" ? undefined : entry.description} onOpen={() => onOpen(entry.id)} />)}</ul>
      {!catalog.plugins.some((entry) => entry.kind === group.kind) ? <p className="settings-hint">{group.empty}</p> : null}
    </section>)}
    <p className="agent-group-where">Pi profile: <code>{catalog.profileDir}</code><br />Forgerie config: <code>{catalog.configPath}</code></p>
  </>;
}

/** Shape: plain values only. A JSON editor avoids executing browser plugins to learn their settings. */
function PluginDetail({ plugin, busy, draft, onEdit, onDiscard, onToggle, onRemove, onSave }: {
  plugin: ManagedPlugin; busy: boolean; draft?: Draft | undefined; onEdit: (text: string) => void; onDiscard: () => void;
  onToggle: (enabled: boolean) => void; onRemove: () => void; onSave: (settings: Record<string, unknown>) => void;
}) {
  const locked = plugin.kind === "builtin";
  const dirty = draft && draft.text !== draft.baseText;
  const settings = draft ? parseSettings(draft.text) : undefined;
  const problem = draft && !settings ? 'Enter a JSON object, for example {"five_hour": true}.' : undefined;
  return <article className="plugin-detail">
    <p className="settings-lede">{plugin.description}</p>
    {locked ? <p className="agent-banner">This add-on is part of Forgerie. It is read-only here.</p> : null}
    {plugin.kind === "forgerie" ? <p className="agent-banner">Browser plugins extend the original Forgerie client. Managing them here does not add their interface to this client.</p> : null}
    <div className="agent-properties">
      <div className="agent-field"><span className="agent-field-label">Source</span><code className="agent-field-value plugin-source">{plugin.source}</code></div>
      <div className="agent-field"><span className="agent-field-label">{plugin.enabled ? "On" : "Off"}</span><div className="agent-field-value">
        <SettingsToggle label={`Enable ${plugin.name}`} checked={plugin.enabled} disabled={busy || locked} onChange={onToggle} /></div></div>
    </div>
    {plugin.kind === "forgerie" && draft ? <form className="plugin-form" onSubmit={(event) => { event.preventDefault(); if (settings && dirty) onSave(settings); }}>
      <label htmlFor="plugin-settings">Plugin settings</label>
      <p className="settings-hint">A JSON object. Omitted values use the plugin's defaults. The plugin defines the keys and their meaning.</p>
      <textarea id="plugin-settings" spellCheck={false} value={draft.text} onChange={(event) => onEdit(event.target.value)} disabled={busy} aria-describedby={problem ? "plugin-settings-problem" : undefined} />
      {problem ? <p id="plugin-settings-problem" className="plugin-problem" role="alert">{problem}</p> : null}
      {dirty ? <button type="button" className="plugin-button" disabled={busy} onClick={onDiscard}>Discard changes</button> : null}
    </form> : null}
    {plugin.kind === "package" ? <div className="plugin-remove"><p className="settings-hint">Turn off to keep the package for later. Remove to unregister it without deleting its code.</p>
      <button type="button" className="plugin-button" data-tone="danger" disabled={busy} onClick={onRemove}>Remove package</button></div> : null}
  </article>;
}
