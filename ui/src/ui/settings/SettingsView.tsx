import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BotIcon, ChevronLeftIcon, CpuIcon, FolderTreeIcon, PlusIcon, PuzzleIcon, XIcon } from "lucide-react";
import { agentsApi, type AgentList, type AgentSummary } from "../../agents/agentsApi";
import { agentDrafts } from "../../agents/agentDrafts";
import { parseModelSpec, modelSpecText } from "../../agents/agentFile";
import { draftKey, type SettingsPlace } from "../../agents/agentPlace";
import { AgentEditor } from "./AgentEditor";
import { SettingsFrame } from "./SettingsFrame";
import { SettingsRow } from "./SettingsRow";
import { PluginsView } from "./PluginsView";
import { ModelsView } from "./ModelsView";
import type { PluginCatalog } from "@shared/pluginsContract";
import "./settings.css";

/**
 * A settings page that another feature draws. Settings passes in its Back and
 * Close controls, the item open on the page, and a way to open another one.
 */
export type SettingsPageRenderer = (page: { back: ReactNode; close: ReactNode; item: string | undefined; onOpen: (item: string | undefined) => void }) => ReactNode;

type ListLoad = { type: "loading" } | { type: "failed"; message: string } | { type: "ready"; value: AgentList };

function useAgentList() {
  const [load, setLoad] = useState<ListLoad>({ type: "loading" });
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const value = await agentsApi.list(signal);
      if (!signal?.aborted) setLoad({ type: "ready", value });
    } catch (error) {
      if (!signal?.aborted) setLoad((current) => current.type === "ready" ? current : { type: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);
  return { load, refresh };
}

const modelText = (agent: AgentSummary) => {
  const spec = parseModelSpec(agent.model);
  return spec ? modelSpecText(spec) : "Session's model";
};

function AgentRow({ agent, replaced, onOpen }: { agent: AgentSummary; replaced: boolean; onOpen: () => void }) {
  const unsaved = agent.scope === "user" && agentDrafts.has(draftKey({ type: "user", file: agent.file }));
  return <SettingsRow name={agent.name} meta={modelText(agent)} description={agent.description || <em>No description</em>}
    dimmed={replaced} onOpen={onOpen} flags={<>
      {replaced ? <span>Replaced by yours</span> : agent.advertise ? <span data-on>Offered to sessions</span> : null}
      {agent.disabled ? <span>Turned off</span> : null}
      {agent.broken ? <span data-tone="error">{agent.broken}</span> : null}
      {unsaved ? <span data-tone="draft">Unsaved changes</span> : null}
    </>} />;
}

/**
 * Binding: the settings pages that take the thread's place. Settings opens
 * from the session list; each page keeps its place in the URL, so Back, a
 * reload, a fold, and a rotation return to the same page.
 */
export function SettingsView({ place, onPlace, onClose, onPluginCatalog, projects }: {
  place: SettingsPlace;
  /** Go to another settings page. `replace` swaps this history entry instead of adding one. */
  onPlace: (place: SettingsPlace, replace?: boolean) => void;
  onClose?: (() => void) | undefined;
  /** Each plugin catalog Settings > Plugins reads, so the app's plugins follow a change at once. */
  onPluginCatalog?: ((catalog: PluginCatalog) => void) | undefined;
  /** Settings → Project groups. Without it, the page is not offered. */
  projects?: SettingsPageRenderer | undefined;
}) {
  const { load, refresh } = useAgentList();
  const close = onClose ? <button type="button" className="picker-icon" aria-label="Close settings" title="Close settings" onClick={onClose}><XIcon aria-hidden size={16} /></button> : null;
  const back = <button type="button" className="settings-back" onClick={() => onPlace({ section: "root" })}><ChevronLeftIcon aria-hidden size={16} />Settings</button>;

  if (place.section === "projects" && projects) {
    const toList = <button type="button" className="settings-back" aria-label="Back to Project groups" onClick={() => onPlace({ section: "projects" })}>
      <ChevronLeftIcon aria-hidden size={16} />Project groups</button>;
    return <>{projects({ back: place.group ? toList : back, close, item: place.group, onOpen: (group) => onPlace({ section: "projects", group }) })}</>;
  }

  if (place.section === "plugins") return <PluginsView selected={place.plugin}
    onOpen={(plugin) => onPlace({ section: "plugins", plugin })} onBack={() => onPlace({ section: "root" })} onClose={onClose} onCatalog={onPluginCatalog} />;

  if (place.section === "models") return <ModelsView onBack={() => onPlace({ section: "root" })} onClose={onClose} />;

  if (place.section === "agents" && place.agent) {
    return <AgentEditor key={JSON.stringify(place.agent)} target={place.agent} home={load.type === "ready" ? load.value.home : undefined}
      onBack={() => onPlace({ section: "agents" })} onClose={onClose}
      onOpen={(agent) => onPlace({ section: "agents", agent }, true)} onSaved={() => void refresh()} />;
  }
  if (place.section === "root" || place.section === "projects") {
    return <SettingsFrame title="Settings" actions={close}>
      <ul className="settings-sections">
        <SettingsRow name={<><CpuIcon aria-hidden size={16} />Models</>} description="The models the model menu offers, and the favorites Ctrl+P switches between."
          onOpen={() => onPlace({ section: "models" })} />
        <SettingsRow name={<><BotIcon aria-hidden size={16} />Agents</>} description="Roles a session can hand work to, each with its own model and instructions."
          onOpen={() => onPlace({ section: "agents" })} />
        <SettingsRow name={<><PuzzleIcon aria-hidden size={16} />Plugins</>} description="Pi packages and extensions, and Forgerie's own plugins, such as account meters."
          onOpen={() => onPlace({ section: "plugins" })} />
        {projects ? <SettingsRow name={<><FolderTreeIcon aria-hidden size={16} />Project groups</>} description="Projects that belong together, such as the repos of one product. The session list can show one group at a time."
          onOpen={() => onPlace({ section: "projects" })} /> : null}
      </ul>
    </SettingsFrame>;
  }

  const agents = load.type === "ready" ? load.value.agents : [];
  const yours = agents.filter((agent) => agent.scope === "user");
  const builtin = agents.filter((agent) => agent.scope === "builtin");
  const yourNames = new Set(yours.map((agent) => agent.name));
  const add = <button type="button" className="settings-primary" onClick={() => onPlace({ section: "agents", agent: { type: "new" } })}>
    <PlusIcon aria-hidden size={14} />New agent</button>;
  return <SettingsFrame back={back} title="Agents" actions={<>{add}{close}</>}
    error={load.type === "failed" ? `Could not read the agent files: ${load.message}` : undefined}
    recovery={load.type === "failed" ? <button onClick={() => void refresh()}>Retry</button> : undefined}>
    <p className="settings-lede">A session hands work to an agent when the work matches the agent's description. Each agent runs on its own model, so a kind of work always goes to the model you chose for it. Changes apply to sessions started after you save.</p>
    {load.type === "loading" ? <p className="settings-hint" role="status">Reading agent files…</p> : null}
    {load.type === "ready" ? <>
      <section className="agent-group" aria-labelledby="agents-yours">
        <h2 id="agents-yours" className="agent-group-label">Yours</h2>
        {yours.length === 0 ? <p className="settings-hint">You have no agents of your own yet. Create one, or open a built-in agent and customize it.</p>
          : <ul className="agent-list">{yours.map((agent) => <AgentRow key={agent.file} agent={agent} replaced={false}
            onOpen={() => onPlace({ section: "agents", agent: { type: "user", file: agent.file } })} />)}</ul>}
        <p className="agent-group-where">Saved in <code>{load.value.userDir}</code></p>
      </section>
      {builtin.length > 0 ? <section className="agent-group" aria-labelledby="agents-builtin">
        <h2 id="agents-builtin" className="agent-group-label">Built in</h2>
        <ul className="agent-list">{builtin.map((agent) => <AgentRow key={agent.file} agent={agent} replaced={yourNames.has(agent.name)}
          onOpen={() => onPlace({ section: "agents", agent: { type: "builtin", file: agent.file } })} />)}</ul>
      </section> : null}
    </> : null}
  </SettingsFrame>;
}
