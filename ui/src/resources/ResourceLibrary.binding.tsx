import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RefreshCwIcon, Undo2Icon } from "lucide-react";
import { HeaderButton } from "../ui/HeaderButton";
import { MenuButton } from "../ui/MenuButton";
import { SettingsFrame } from "../ui/settings/SettingsFrame";
import { SheetDialog } from "../ui/SheetDialog";
import { Lede } from "../ui/Lede";
import { ResourceList } from "./ResourceList";
import { ResourceDocument, type SaveReport } from "./ResourceDocument";
import { ResourceRequestError, type ResourceApi, type ResourceFile, type ResourceInventory, type ResourceKind, type ResourceTarget } from "./resourceApi";
import { checkoutName, hides, refusalAdvice, savedMessage } from "./resourceModel";

const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
type Load<T> = { type: "loading" } | { type: "failed"; message: string } | { type: "ready"; value: T };

// Drafts outlive a page, as agent drafts do, so Back, a fold and closing the sheet keep them. They hold no secrets.
const drafts = new Map<string, string>();
const targetKey = (target: ResourceTarget) => target.kind === "settings" ? "settings" : `session:${target.sessionId}`;

/**
 * The editor's state for one place: the list, the open file, its draft, and
 * what the last save said. Settings and a session's sheet both use it.
 */
function useResourceLibrary(api: ResourceApi, target: ResourceTarget, openId: string | undefined) {
  const key = targetKey(target);
  const [inventory, setInventory] = useState<Load<ResourceInventory>>({ type: "loading" });
  const [file, setFile] = useState<Load<ResourceFile>>({ type: "loading" });
  const [report, setReport] = useState<SaveReport>();
  const [saving, setSaving] = useState(false);
  const [, redraw] = useState(0);
  const latestTarget = useRef(target);
  latestTarget.current = target;

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const value = await api.list(latestTarget.current, signal);
      if (!signal?.aborted) setInventory({ type: "ready", value });
    } catch (cause) {
      if (!signal?.aborted) setInventory((current) => current.type === "ready" ? current : { type: "failed", message: message(cause) });
    }
  }, [api]);
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, [refresh, key]);

  const readFile = useCallback(async (id: string, signal?: AbortSignal) => {
    setFile({ type: "loading" });
    try {
      const value = await api.read(latestTarget.current, id, signal);
      if (!signal?.aborted) setFile({ type: "ready", value });
    } catch (cause) {
      if (!signal?.aborted) setFile({ type: "failed", message: message(cause) });
    }
  }, [api]);
  useEffect(() => {
    setReport(undefined);
    if (openId === undefined) return;
    const controller = new AbortController();
    void readFile(openId, controller.signal);
    return () => controller.abort();
  }, [openId, readFile, key]);

  const draftKey = (id: string) => `${key}:${id}`;
  const draft = openId === undefined ? undefined : drafts.get(draftKey(openId));
  const ready = file.type === "ready" && file.value.resource.id === openId ? file.value : undefined;
  const dirty = ready !== undefined && draft !== undefined && draft !== ready.text;

  const change = (text: string) => {
    if (!ready) return;
    const id = draftKey(ready.resource.id);
    const had = drafts.has(id) && drafts.get(id) !== ready.text;
    if (text === ready.text) drafts.delete(id); else drafts.set(id, text);
    if (had !== (text !== ready.text)) redraw((count) => count + 1);
  };
  const discard = () => { if (openId) { drafts.delete(draftKey(openId)); setReport(undefined); void readFile(openId); } };
  const save = async () => {
    if (!ready || !dirty || saving || ready.resource.edit.kind === "read-only" || draft === undefined) return;
    setSaving(true);
    try {
      const result = await api.save(latestTarget.current, ready.resource.id, draft, ready.revision);
      drafts.delete(draftKey(ready.resource.id));
      setFile({ type: "ready", value: result.file });
      setReport({ kind: "saved", message: savedMessage(result.effect) });
      void refresh();
    } catch (cause) {
      const refused = cause instanceof ResourceRequestError ? cause : undefined;
      setReport({ kind: "refused", message: message(cause), advice: refused ? refusalAdvice(refused.kind, refused.savedToDisk) : undefined });
      // The text on disk is the draft now: read it back, so the next save starts from what is there.
      if (refused?.savedToDisk) { drafts.delete(draftKey(ready.resource.id)); void readFile(ready.resource.id); void refresh(); }
    } finally { setSaving(false); }
  };
  const unsaved = useCallback((id: string) => drafts.has(`${key}:${id}`), [key]);
  return { inventory, file, ready, draft, dirty, saving, report, refresh, change, save, discard, unsaved };
}
type Library = ReturnType<typeof useResourceLibrary>;

/** The list's own choices, kept across opening a file and coming back. */
function useListChoices(library: Library, openId: string | undefined) {
  const [kind, setKind] = useState<ResourceKind>("skill");
  const [query, setQuery] = useState("");
  // A file opened from the URL shows its own kind when the reader goes back.
  const openKind = library.ready?.resource.kind;
  useEffect(() => { if (openKind && openId) setKind(openKind); }, [openKind, openId]);
  return { kind, setKind, query, setQuery };
}

function Body({ library, choices, scope, openId, onOpen, intro }: {
  library: Library; choices: ReturnType<typeof useListChoices>; scope: ResourceTarget; openId: string | undefined;
  onOpen: (id: string) => void; intro: ReactNode;
}) {
  const { inventory, file, ready, draft, report } = library;
  const entries = useMemo(() => inventory.type === "ready" ? inventory.value.resources : [], [inventory]);
  if (openId !== undefined) {
    if (file.type === "failed") return <Lede>Could not read the file: {file.message}</Lede>;
    if (!ready) return <Lede>Reading the file…</Lede>;
    const current = entries.find((entry) => entry.id === ready.resource.id) ?? ready.resource;
    const winner = current.activation.kind === "shadowed" ? entries.find((entry) => current.activation.kind === "shadowed" && entry.id === current.activation.winnerId) : undefined;
    return <ResourceDocument key={`${ready.resource.id}:${ready.revision}`} entry={current} hiddenBy={winner} hides={hides(current, entries)}
      scope={inventory.type === "ready" ? inventory.value.scope : scope.kind === "settings" ? { kind: "settings" } : undefined}
      text={draft ?? ready.text} report={report} onChange={library.change} onSave={() => void library.save()} />;
  }
  if (inventory.type === "failed") return <Lede>Could not list the files: {inventory.message}</Lede>;
  if (inventory.type === "loading") return <Lede>Reading the files…</Lede>;
  return <>
    {intro}
    <ResourceList entries={entries} kind={choices.kind} query={choices.query} diagnostics={inventory.value.diagnostics} unsaved={library.unsaved}
      onKind={choices.setKind} onQuery={choices.setQuery} onOpen={onOpen} />
  </>;
}

const commands = (library: Library) => [
  { label: "Discard edits", icon: <Undo2Icon aria-hidden />, disabled: !library.dirty, onSelect: library.discard },
  // A draft is never dropped by a refresh; Discard edits does that on purpose.
  { label: "Read the file again", icon: <RefreshCwIcon aria-hidden />, disabled: library.dirty, onSelect: () => { void library.refresh(); library.discard(); } },
];

/**
 * Settings → Skills and prompts: your files, Forgerie's and the packages',
 * one place to read and edit them. A project's own files open from its
 * sessions, where the checkout is known. `item` is the open file's id.
 */
export function ResourceSettings({ api, item, onOpen, back, close }: {
  api: ResourceApi; item: string | undefined; onOpen: (item: string | undefined) => void; back: ReactNode; close: ReactNode;
}) {
  const target = useMemo<ResourceTarget>(() => ({ kind: "settings" }), []);
  const library = useResourceLibrary(api, target, item);
  const choices = useListChoices(library, item);
  const entry = library.ready?.resource;
  const writable = entry?.edit.kind === "writable";
  return <SettingsFrame back={back} title={item && entry ? entry.name : "Skills and prompts"} status={library.saving ? "Saving…" : undefined}
    actions={<>
      {item && writable ? <HeaderButton label="Save" disabled={!library.dirty || library.saving} onPress={() => void library.save()} /> : null}
      {item ? <MenuButton label="File commands" commands={commands(library)} /> : null}
      {close}
    </>}>
    <Body library={library} choices={choices} scope={target} openId={item} onOpen={onOpen}
      intro={<Lede>The skills, prompt templates and context files Pi reads for every session. Files from Forgerie and from packages are read-only, because an update replaces them. A project’s own files open from one of its sessions: Session menu, then Skills and prompts.</Lede>} />
  </SettingsFrame>;
}

/** A session's Skills and prompts: what loads in its own checkout, in a sheet over the chat. */
export function ResourceLens({ api, sessionId, cwd, onClose }: { api: ResourceApi; sessionId: string; cwd: string; onClose: () => void }) {
  const target = useMemo<ResourceTarget>(() => ({ kind: "session", sessionId }), [sessionId]);
  const [openId, setOpenId] = useState<string>();
  const library = useResourceLibrary(api, target, openId);
  const choices = useListChoices(library, openId);
  const entry = openId ? library.ready?.resource : undefined;
  const checkout = library.inventory.type === "ready" && library.inventory.value.scope.kind === "session" ? library.inventory.value.scope.cwd : cwd;
  return <SheetDialog title={entry ? entry.name : "Skills and prompts"} subtitle={`in ${checkoutName(checkout)}`} closeLabel="Close skills and prompts" onClose={onClose}
    back={openId ? { label: "Back to the list", onPress: () => setOpenId(undefined) } : undefined}
    actions={entry?.edit.kind === "writable" ? [
      { label: library.saving ? "Saving…" : "Save", disabled: !library.dirty || library.saving, onPress: () => void library.save() },
      ...(library.dirty ? [{ label: "Discard", onPress: library.discard }] : []),
    ] : []}>
    <Body library={library} choices={choices} scope={target} openId={openId} onOpen={setOpenId}
      intro={<Lede>What this session’s checkout loads: its own files first, then yours, Forgerie’s and the packages’. Saving never reloads a running session; run /reload here to use a change.</Lede>} />
  </SheetDialog>;
}
