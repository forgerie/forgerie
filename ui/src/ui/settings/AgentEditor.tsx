import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeftIcon, EllipsisIcon, Trash2Icon, XIcon } from "lucide-react";
import type { SessionModel } from "../../contracts";
import { modelLabel } from "../../modelChoice";
import { thinkingLevelsFor } from "../../newSession";
import { composeAgentFile, fileIdFor, FORM_FIELDS, NEW_AGENT_TEXT, modelSpecText, parseAgentFile, parseList, parseModelSpec, readFields, setField } from "../../agents/agentFile";
import { agentDrafts } from "../../agents/agentDrafts";
import { draftKey, type AgentTarget } from "../../agents/agentPlace";
import { AgentConflict, agentsApi } from "../../agents/agentsApi";
import { framePromptBody } from "../../agents/promptMarkdown";
import { ModelPicker, type ModelBinding, type PickerOpen } from "../ModelPicker";
import { PromptEditor } from "./PromptEditor";
import { SettingsFrame } from "./SettingsFrame";
import { SettingsToggle } from "./SettingsToggle";
import { SettingsField as Field } from "./SettingsField";
import "./settings.css";


type Loaded = { baseText: string; baseMtimeMs: number | null; readOnly: boolean };
type Load = { type: "loading" } | { type: "failed"; message: string } | { type: "ready"; value: Loaded };
type Save = { type: "idle" } | { type: "saving" } | { type: "failed"; message: string; conflict: boolean } | { type: "saved" };

/** The models Pi offers, read once per editor. */
function useModels(home: string | undefined) {
  const promise = useRef<Promise<SessionModel[]> | undefined>(undefined);
  const [models, setModels] = useState<SessionModel[]>([]);
  const list = useCallback(async () => {
    if (!home) throw new Error("The agents list has not loaded yet.");
    promise.current ??= fetch(`/api/models?${new URLSearchParams({ cwd: home })}`).then(async (response) => {
      if (!response.ok) throw new Error(`Pi answered ${String(response.status)}.`);
      const value = await response.json() as { models?: SessionModel[] };
      return value.models ?? [];
    }).catch((error: unknown) => { promise.current = undefined; throw error; });
    const value = await promise.current;
    setModels(value);
    return value;
  }, [home]);
  useEffect(() => { void list().catch(() => { /* The picker reports it when opened. */ }); }, [list]);
  return { models, list };
}

/** A model reference, matched to Pi's list so it shows Pi's name. A bare id matches when only one provider has it. */
function resolveModel(spec: string | undefined, models: readonly SessionModel[]): SessionModel | undefined {
  const parsed = parseModelSpec(spec);
  if (!parsed) return undefined;
  const matches = models.filter((model) => model.id === parsed.id && (!parsed.provider || model.provider === parsed.provider));
  return matches.length === 1 ? matches[0] : { provider: parsed.provider ?? "", id: parsed.id, name: modelSpecText(parsed) };
}

/**
 * Binding and organism: one agent file. The header becomes a form and the body
 * a document. Only the header lines a control changes are rewritten, and the
 * body is written back only after it is edited, so a save never reformats what
 * was not touched.
 */
export function AgentEditor({ target, home, onBack, onClose, onOpen, onSaved }: {
  target: AgentTarget; home: string | undefined;
  onBack: () => void; onClose?: (() => void) | undefined;
  /** Move to another file, replacing this place in history. */
  onOpen: (target: AgentTarget) => void;
  onSaved: () => void;
}) {
  const key = draftKey(target);
  const [load, setLoad] = useState<Load>({ type: "loading" });
  const [text, setText] = useState("");
  // Bumped to remount the document when the file is replaced from outside it.
  const [revision, setRevision] = useState(0);
  const [save, setSave] = useState<Save>({ type: "idle" });
  const [menu, setMenu] = useState<"closed" | "open" | "confirm">("closed");
  const [modelOpen, setModelOpen] = useState<PickerOpen>();
  const modelAnchor = useRef<HTMLDivElement>(null);
  const { models, list: listModels } = useModels(home);

  const open = useCallback(async (signal?: AbortSignal, ignoreDraft = false) => {
    setLoad({ type: "loading" });
    try {
      let loaded: Loaded;
      if (target.type === "new") loaded = { baseText: NEW_AGENT_TEXT, baseMtimeMs: null, readOnly: false };
      else if (target.type === "customize") {
        const builtin = await agentsApi.read("builtin", target.file, signal);
        loaded = { baseText: builtin.text, baseMtimeMs: null, readOnly: false };
      } else {
        const file = await agentsApi.read(target.type, target.file, signal);
        loaded = { baseText: file.text, baseMtimeMs: file.mtimeMs, readOnly: target.type === "builtin" };
      }
      if (signal?.aborted) return;
      const draft = ignoreDraft || loaded.readOnly ? undefined : agentDrafts.read(key);
      setText(draft?.text ?? loaded.baseText);
      setLoad({ type: "ready", value: draft ? { ...loaded, baseText: draft.baseText, baseMtimeMs: draft.baseMtimeMs } : loaded });
      setRevision((value) => value + 1);
    } catch (error) {
      if (!signal?.aborted) setLoad({ type: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }, [target, key]);
  useEffect(() => {
    const controller = new AbortController();
    void open(controller.signal);
    return () => controller.abort();
  }, [open]);

  const ready = load.type === "ready" ? load.value : undefined;
  const readOnly = ready?.readOnly ?? true;
  const file = useMemo(() => parseAgentFile(text), [text]);
  const fields = useMemo(() => readFields(file.header), [file.header]);
  const dirty = ready !== undefined && text !== ready.baseText;
  // Every change lands in the draft at once: a fold, a reload, or a session switch loses nothing.
  useEffect(() => {
    if (ready && !ready.readOnly) agentDrafts.write(key, { baseText: ready.baseText, baseMtimeMs: ready.baseMtimeMs, text });
  }, [ready, key, text]);

  const update = (field: string, value: string | undefined) => {
    setSave((current) => current.type === "saved" ? { type: "idle" } : current);
    setText((current) => {
      const parsed = parseAgentFile(current);
      return composeAgentFile({ header: setField(parsed.header, field, value), body: parsed.body });
    });
  };
  const onBody = useCallback((markdown: string) => {
    setSave((current) => current.type === "saved" ? { type: "idle" } : current);
    setText((current) => {
      const parsed = parseAgentFile(current);
      return composeAgentFile({ header: parsed.header ?? [], body: framePromptBody(parsed.body, markdown) });
    });
  }, []);

  const name = fields.name ?? "";
  const advertise = fields.advertise === "true";
  const problems = [
    !name.trim() ? "Give the agent a name." : undefined,
    advertise && !fields.description?.trim() ? "Sessions choose an offered agent by its description. Describe the work it is for." : undefined,
    fields.fallbackModels !== undefined ? "Remove the fallbacks, or sessions cannot use this agent." : undefined,
  ].filter((item): item is string => item !== undefined);

  async function onSave() {
    if (!ready || readOnly || problems.length > 0 || save.type === "saving") return;
    setSave({ type: "saving" });
    const fileId = target.type === "new" ? fileIdFor(name) : target.file;
    const scope = target.type === "home" ? "home" : "user";
    try {
      const saved = await agentsApi.write(scope, fileId, text, ready.baseMtimeMs);
      agentDrafts.clear(key);
      setLoad({ type: "ready", value: { baseText: saved.text, baseMtimeMs: saved.mtimeMs, readOnly: false } });
      setSave({ type: "saved" });
      onSaved();
      if (target.type !== scope) onOpen({ type: scope, file: fileId });
    } catch (error) {
      setSave({ type: "failed", message: error instanceof Error ? error.message : String(error), conflict: error instanceof AgentConflict });
    }
  }
  async function onDelete() {
    if (!ready || (target.type !== "user" && target.type !== "home") || ready.baseMtimeMs === null) return;
    try {
      await agentsApi.remove(target.type, target.file, ready.baseMtimeMs);
      agentDrafts.clear(key);
      onSaved();
      onBack();
    } catch (error) {
      setMenu("closed");
      setSave({ type: "failed", message: error instanceof Error ? error.message : String(error), conflict: error instanceof AgentConflict });
    }
  }
  const discard = () => { agentDrafts.clear(key); setSave({ type: "idle" }); void open(undefined, true); };

  // Ctrl or Cmd + S saves, as in every editor.
  const saveRef = useRef(onSave);
  useLayoutEffect(() => { saveRef.current = onSave; });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void saveRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const model = resolveModel(fields.model, models);
  const spec = parseModelSpec(fields.model);
  const thinking = fields.thinking ?? spec?.level;
  const modelBinding: ModelBinding = {
    model, thinkingLevel: thinking, disabled: readOnly, emptyLabel: "Same as the session",
    listModels, listThinkingLevels: async () => thinkingLevelsFor(model),
    onModel: async (provider, id) => {
      // A level written into the old model reference moves to its own field.
      if (spec?.level && fields.thinking === undefined) update("thinking", spec.level);
      update("model", `${provider}/${id}`);
    },
    onThinkingLevel: async (level) => {
      if (spec?.level) update("model", modelSpecText(spec));
      update("thinking", level);
    },
  };
  // pi-subagents 0.76 removed fallbacks: a file that still has them does not load at all.
  const fallbacks = parseList(fields.fallbackModels);
  // A field's block lines belong to it, so they leave with it above.
  const otherLines = useMemo(() => {
    const keep: string[] = [];
    let inForm = false;
    for (const line of file.header ?? []) {
      const field = /^([\w-]+):/.exec(line)?.[1];
      if (field) inForm = (FORM_FIELDS as readonly string[]).includes(field);
      if (!inForm && line.trim() !== "") keep.push(line);
    }
    return keep;
  }, [file.header]);

  const title = name.trim() || (target.type === "new" ? "New agent" : target.file);
  const back = <button type="button" className="settings-back" onClick={onBack}><ChevronLeftIcon aria-hidden size={16} />Agents</button>;
  const actions = <>
    {readOnly && target.type === "builtin" && ready
      ? <button type="button" className="settings-primary" onClick={() => onOpen({ type: "customize", file: target.file })}>Customize</button>
      : <button type="button" className="settings-primary" disabled={!ready || !dirty || problems.length > 0 || save.type === "saving"}
        aria-keyshortcuts="Control+S" title="Save (Ctrl+S)" onClick={() => void onSave()}>{save.type === "saving" ? "Saving…" : "Save"}</button>}
    {target.type === "user" || target.type === "home" || (dirty && !readOnly) ? <div className="settings-menu-anchor">
      <button type="button" className="picker-icon" aria-label="More agent commands" aria-haspopup="menu" aria-expanded={menu !== "closed"}
        onClick={() => setMenu(menu === "closed" ? "open" : "closed")}><EllipsisIcon aria-hidden size={16} /></button>
      {menu !== "closed" ? <div className="picker-menu" role="menu" aria-label="Agent commands">
        {dirty && !readOnly ? <button role="menuitem" onClick={() => { setMenu("closed"); discard(); }}><XIcon aria-hidden />Discard changes</button> : null}
        {target.type === "user" || target.type === "home" ? <button role="menuitem" data-tone="danger" onClick={() => { if (menu === "confirm") void onDelete(); else setMenu("confirm"); }}>
          <Trash2Icon aria-hidden />{menu === "confirm" ? "Delete for good?" : "Delete agent"}</button> : null}
      </div> : null}
    </div> : null}
    {onClose ? <button type="button" className="picker-icon" aria-label="Close settings" title="Close settings" onClick={onClose}><XIcon aria-hidden size={16} /></button> : null}
  </>;
  const status = save.type === "saved" ? "Saved. New sessions use it." : dirty ? "Unsaved changes" : "";

  return <SettingsFrame back={back} title={title} status={status} actions={actions}
    error={load.type === "failed" ? load.message : save.type === "failed" ? save.message : undefined}
    recovery={load.type === "failed" ? <button onClick={() => void open()}>Retry</button>
      : save.type === "failed" && save.conflict ? <button onClick={discard}>Reload the file</button> : undefined}>
    {load.type === "loading" ? <p className="settings-hint" role="status">Opening the agent…</p> : null}
    {ready ? <div className="agent-editor">
      {readOnly ? <p className="agent-banner">This agent comes with Forgerie and cannot be changed here. Customize it to save your own copy, which replaces it in every new session.</p> : null}
      {target.type === "customize" ? <p className="agent-banner">You are editing your own copy of the built-in <code>{target.file}</code> agent. Saving it replaces the built-in one in every new session.</p> : null}
      <input className="agent-name" aria-label="Agent name" placeholder="Name the agent" value={name} readOnly={readOnly}
        spellCheck={false} autoCapitalize="off" onChange={(event) => update("name", event.target.value)} />
      <textarea className="agent-description" aria-label="Description" rows={2} readOnly={readOnly}
        placeholder="When should a session hand work to this agent? For example: Reviews a diff for correctness and missing tests."
        value={fields.description ?? ""} onChange={(event) => update("description", event.target.value)} />

      <div className="agent-properties">
        <Field label="Model" hint={model ? undefined : "Without a model, the agent runs on whatever model the session uses."}>
          <div ref={modelAnchor} className="agent-model">
            <ModelPicker binding={modelBinding} anchor={modelAnchor} open={modelOpen} onOpenChange={setModelOpen} />
            {fields.model && !readOnly ? <button type="button" className="agent-text-button" onClick={() => { update("model", undefined); }}>Use the session's model</button> : null}
          </div>
        </Field>
        {fields.fallbackModels !== undefined ? <Field label="Fallbacks" hint={<>Sessions cannot use this agent while the file lists fallbacks. pi-subagents dropped them: each run uses one model.</>}>
          <div className="agent-chips">
            {fallbacks.map((item) => <span key={item} className="agent-chip" data-tone="error"><span>{modelLabel(resolveModel(item, models))}</span></span>)}
            {readOnly ? null : <button type="button" className="agent-text-button" onClick={() => update("fallbackModels", undefined)}>Remove fallbacks</button>}
          </div>
        </Field> : null}
        <Field label="Offer to sessions" id="agent-advertise" hint={advertise
          ? "Every new session sees this agent's name and description, and hands it matching work without being told."
          : "Sessions use this agent only when someone names it."}>
          <SettingsToggle label="Offer to sessions" checked={advertise} disabled={readOnly}
            onChange={(checked) => update("advertise", checked ? "true" : undefined)} />
        </Field>
        {otherLines.length > 0 ? <Field label="Also in the file" hint="Kept as written. Edit these in the file itself.">
          <pre className="agent-other">{otherLines.join("\n")}</pre>
        </Field> : null}
      </div>
      {problems.length > 0 && !readOnly && (dirty || fields.fallbackModels !== undefined) ? <ul className="agent-problems" role="status">{problems.map((item) => <li key={item}>{item}</li>)}</ul> : null}

      <h2 className="agent-section">Instructions</h2>
      <PromptEditor key={revision} initial={file.body} readOnly={readOnly} label="Instructions" onChange={onBody} />
    </div> : null}
  </SettingsFrame>;
}
