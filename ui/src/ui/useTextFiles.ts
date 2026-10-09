import { useCallback, useEffect, useRef, useState } from "react";
import { dirtyPaths, edited, opened, savePlan, saving, settled, type Expected, type FileBuffer, type OpenedFile, type SaveResult } from "./textBuffers";
import { foldersOf, type Folder, type FolderLoad } from "./lazyTree";

/** Where the files come from: folder listings, reads with a version, and writes that must match one. */
export interface TextFileSource {
  folder(path: string, signal: AbortSignal): Promise<Folder>;
  read(path: string, signal: AbortSignal): Promise<OpenedFile>;
  write(path: string, text: string, expected: Expected, signal: AbortSignal): Promise<SaveResult>;
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

export interface TextFiles {
  folders: ReadonlyMap<string, FolderLoad>;
  /** Open folders, by path. */
  open: ReadonlySet<string>;
  buffers: Readonly<Record<string, FileBuffer>>;
  /** The paths with unsaved edits now, including keystrokes the last render has not shown yet. */
  unsaved: () => string[];
  /** Read a folder's listing if the tree does not hold it yet, or again when `again`. */
  readFolder: (path: string, again?: boolean) => void;
  toggleFolder: (path: string, open: boolean) => void;
  /** Open every folder above a file, so its row shows. */
  reveal: (path: string) => void;
  /** Read every listing the tree holds again. The old listing stays until the new one arrives. */
  refresh: () => void;
  /** Read a file unless its buffer is already open. */
  openFile: (path: string) => void;
  edit: (path: string, text: string) => void;
  /** Save a buffer's edits. `force` is the reader's answer to a conflict: write over what the disk holds now. */
  save: (path: string, force?: boolean) => void;
  /** Read the file again, dropping its edits. */
  reload: (path: string) => void;
  discard: (path: string) => void;
}

/**
 * A folder tree whose folders are listed as they open, and one text buffer
 * per opened file. Buffers outlive the file being on screen, so moving to
 * another file keeps unsaved edits. `onSaved` hears each successful write.
 */
export function useTextFiles(source: TextFileSource, onSaved: (path: string) => void): TextFiles {
  const [folders, setFolders] = useState<ReadonlyMap<string, FolderLoad>>(() => new Map());
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [buffers, setBuffers] = useState<Readonly<Record<string, FileBuffer>>>({});
  // Saves read the buffer as it is when they start and when they finish, not as the last render saw it.
  const latest = useRef({ folders, buffers, onSaved });
  latest.current.onSaved = onSaved;
  const life = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    return () => controller.abort();
  }, [source]);

  const setFolder = useCallback((path: string, load: FolderLoad) => {
    latest.current.folders = new Map(latest.current.folders).set(path, load);
    setFolders(latest.current.folders);
  }, []);
  const update = useCallback((path: string, change: (buffer: FileBuffer | undefined) => FileBuffer | undefined) => {
    const next = { ...latest.current.buffers };
    const changed = change(next[path]);
    if (changed === undefined) delete next[path]; else next[path] = changed;
    latest.current.buffers = next;
    setBuffers(next);
  }, []);

  const readFolder = useCallback((path: string, again = false) => {
    const known = latest.current.folders.get(path);
    if (known && known.type !== "failed" && !again) return;
    if (!known || known.type === "failed") setFolder(path, { type: "loading" });
    const { signal } = life.current;
    source.folder(path, signal).then(
      (folder) => { if (!signal.aborted) setFolder(path, { type: "ready", folder }); },
      (error: unknown) => { if (!signal.aborted) setFolder(path, { type: "failed", message: messageOf(error) }); },
    );
  }, [source, setFolder]);

  const toggleFolder = useCallback((path: string, isOpen: boolean) => {
    if (isOpen) readFolder(path);
    setOpen((now) => {
      const next = new Set(now);
      if (isOpen) next.add(path); else next.delete(path);
      return next;
    });
  }, [readFolder]);

  const reveal = useCallback((path: string) => {
    const above = foldersOf(path);
    readFolder("");
    for (const folder of above) readFolder(folder);
    setOpen((now) => above.every((folder) => now.has(folder)) ? now : new Set([...now, ...above]));
  }, [readFolder]);

  const refresh = useCallback(() => {
    for (const path of latest.current.folders.keys()) readFolder(path, true);
  }, [readFolder]);

  const read = useCallback((path: string) => {
    const { signal } = life.current;
    source.read(path, signal).then(
      (file) => { if (!signal.aborted) update(path, (buffer) => opened(buffer, file)); },
      (error: unknown) => {
        if (signal.aborted) return;
        // An open buffer keeps its text: losing the edits because a read failed would be worse than the read failing.
        update(path, (buffer) => buffer?.type === "open"
          ? { ...buffer, save: { type: "failed", message: `The file could not be read again. ${messageOf(error)}` } }
          : { type: "failed", message: messageOf(error) });
      },
    );
  }, [source, update]);

  const openFile = useCallback((path: string) => {
    const known = latest.current.buffers[path];
    if (known?.type === "open" || known?.type === "loading" || known?.type === "locked") return;
    update(path, () => ({ type: "loading" }));
    read(path);
  }, [read, update]);

  const save = useCallback((path: string, force = false) => {
    const plan = savePlan(latest.current.buffers[path], force);
    if (!plan) return;
    update(path, (buffer) => buffer && saving(buffer, plan.text));
    const { signal } = life.current;
    source.write(path, plan.disk, plan.expected, signal).then(
      (result) => {
        if (signal.aborted) return;
        update(path, (buffer) => buffer && settled(buffer, result));
        if (result.type === "saved") latest.current.onSaved(path);
      },
      (error: unknown) => { if (!signal.aborted) update(path, (buffer) => buffer && settled(buffer, { type: "failed", message: `Not saved. ${messageOf(error)}` })); },
    );
  }, [source, update]);

  return {
    folders, open, buffers, unsaved: useCallback(() => dirtyPaths(latest.current.buffers), []), readFolder, toggleFolder, reveal, refresh, openFile, save,
    edit: useCallback((path: string, text: string) => update(path, (buffer) => buffer && edited(buffer, text)), [update]),
    reload: read,
    discard: useCallback((path: string) => update(path, () => undefined), [update]),
  };
}
