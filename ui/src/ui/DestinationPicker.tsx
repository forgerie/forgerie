import { usePortalTarget } from "./portalLayer";
import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, FolderIcon } from "lucide-react";
import type { Project, Workspace } from "../newSession";
import { usePanelPlacement } from "./usePanelPlacement";

/** Where a new session starts, and the folders it could start in instead. */
export interface DestinationBinding {
  cwd: string;
  label: string;
  disabled: boolean;
  listProjects: (signal: AbortSignal) => Promise<Project[]>;
  listWorkspaces: (projectId: string, signal: AbortSignal) => Promise<Workspace[]>;
  onChoose: (cwd: string, label: string) => void;
}

type Load<T> = { type: "loading" } | { type: "ready"; value: T } | { type: "failed"; message: string };
type Step = { type: "projects" } | { type: "workspaces"; project: Project };
const PANEL_CAP = 416;
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

function useRead<T>(read: ((signal: AbortSignal) => Promise<T>) | undefined, key: string): Load<T> {
  const [state, setState] = useState<{ key: string; load: Load<T> }>({ key, load: { type: "loading" } });
  const latest = useRef(read);
  latest.current = read;
  useEffect(() => {
    const run = latest.current;
    if (!run) return;
    const controller = new AbortController();
    setState({ key, load: { type: "loading" } });
    run(controller.signal).then((value) => { if (!controller.signal.aborted) setState({ key, load: { type: "ready", value } }); },
      (error: unknown) => { if (!controller.signal.aborted) setState({ key, load: { type: "failed", message: messageOf(error) } }); });
    return () => controller.abort();
  }, [key]);
  return state.key === key ? state.load : { type: "loading" };
}

/**
 * System molecule: the new session's destination, one line above the input
 * bar. It stays on the surface at every size, so the choice is always one tap
 * away. The panel opens at window level: projects first, then the chosen
 * project's workspaces.
 */
export function DestinationPicker({ binding }: { binding: DestinationBinding }) {
  const [open, setOpen] = useState(false);
  const layer = usePortalTarget();
  const row = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = (returnFocus: boolean) => { setOpen(false); if (returnFocus) trigger.current?.focus({ preventScroll: true }); };
  return <div ref={row} className="destination">
    <FolderIcon aria-hidden size={14} />
    <span className="destination-lead" id={`${panelId}-lead`}>Start in</span>
    <button ref={trigger} type="button" className="destination-trigger" disabled={binding.disabled}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined}
      aria-labelledby={`${panelId}-lead ${panelId}-value`} title={binding.cwd} onClick={() => setOpen(!open)}>
      <span className="destination-value" id={`${panelId}-value`}>{binding.label}</span>
      <ChevronDownIcon aria-hidden size={14} />
    </button>
    {open && createPortal(<DestinationPanel id={panelId} binding={binding} anchor={row} trigger={trigger} onClose={close} />, layer)}
  </div>;
}

/** How a destination reads: the project, then the workspace when it is not the project's own folder. */
function workspaceLabel(project: Project, workspace: Workspace): string {
  return workspace.isMain || workspace.path === project.path ? project.name : `${project.name} · ${workspace.branch ?? workspace.label}`;
}

function DestinationPanel({ id, binding, anchor, trigger, onClose }: {
  id: string; binding: DestinationBinding; anchor: RefObject<HTMLDivElement | null>; trigger: RefObject<HTMLButtonElement | null>;
  onClose: (returnFocus: boolean) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<Step>({ type: "projects" });
  const cameFrom = useRef<string | undefined>(undefined);
  const [query, setQuery] = useState("");
  const projects = useRead(binding.listProjects, "projects");
  const project = step.type === "workspaces" ? step.project : undefined;
  const workspaces = useRead(project ? (signal) => binding.listWorkspaces(project.id, signal) : undefined, project?.id ?? "none");
  usePanelPlacement(panel, anchor, PANEL_CAP);
  // Focus moves in at once, so Escape always reaches the panel; no touch keyboard opens.
  useLayoutEffect(() => {
    const back = step.type === "projects" && cameFrom.current
      ? panel.current?.querySelector<HTMLButtonElement>(`[data-project="${cameFrom.current}"]`) : undefined;
    (back ?? panel.current)?.focus({ preventScroll: true });
  }, [step]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) onClose(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [onClose, trigger]);
  // Focus leaving the panel by keyboard closes it, as a tap outside does.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && !panel.current?.contains(next)) onClose(false);
  };
  // A project with one checkout needs no second step. Once per project.
  const autoChosen = useRef<string | undefined>(undefined);
  const latest = useRef({ binding, onClose });
  latest.current = { binding, onClose };
  useEffect(() => {
    if (!project || workspaces.type !== "ready" || workspaces.value.length !== 1 || autoChosen.current === project.id) return;
    autoChosen.current = project.id;
    const only = workspaces.value[0]!;
    latest.current.binding.onChoose(only.path, workspaceLabel(project, only));
    latest.current.onClose(true);
  }, [project, workspaces]);
  const choose = (cwd: string, label: string) => { binding.onChoose(cwd, label); onClose(true); };
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      if (step.type === "workspaces") setStep({ type: "projects" }); else onClose(true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = [...(panel.current?.querySelectorAll<HTMLButtonElement>(".destination-row") ?? [])];
    if (rows.length === 0) return;
    event.preventDefault();
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = index === -1 ? (event.key === "ArrowDown" ? 0 : rows.length - 1)
      : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
    rows[next]?.focus();
  }
  const needle = query.trim().toLowerCase();
  const shownProjects = projects.type === "ready"
    ? projects.value.filter((item) => !needle || item.name.toLowerCase().includes(needle) || item.path.toLowerCase().includes(needle)) : [];
  return <div ref={panel} id={id} className="model-panel destination-panel" role="dialog" tabIndex={-1} onBlur={onBlur}
    aria-label={project ? `Workspaces of ${project.name}` : "Where the session starts"} onKeyDown={onKeyDown}>
    {step.type === "projects" ? <>
      <input type="search" className="model-search" placeholder="Search projects" aria-label="Search projects"
        value={query} onChange={(event) => setQuery(event.target.value)} enterKeyHint="search" />
      <div className="model-list">
        {projects.type === "loading" && <p className="model-hint" role="status">Loading projects…</p>}
        {projects.type === "failed" && <p className="model-hint" role="alert">Projects unavailable: {projects.message}</p>}
        {projects.type === "ready" && shownProjects.length === 0 && <p className="model-hint" role="status">
          {needle ? `No project matches "${query.trim()}".` : "Forgerie knows no projects yet. Add one in the old client."}
        </p>}
        <ul>{shownProjects.map((item) => {
          const here = binding.cwd === item.path || binding.cwd.startsWith(`${item.path}/`);
          return <li key={item.id}><button type="button" className="model-row destination-row" aria-current={here || undefined}
            data-project={item.id} onClick={() => { cameFrom.current = item.id; setQuery(""); setStep({ type: "workspaces", project: item }); }}>
            <span className="model-row-name">{item.name}</span>
            <span className="model-row-meta"><span className="destination-path">{item.path}</span></span>
            {here && <CheckIcon aria-hidden size={16} className="model-row-check" />}
          </button></li>;
        })}</ul>
      </div>
    </> : <>
      <button type="button" className="destination-back" onClick={() => setStep({ type: "projects" })}>
        <ChevronLeftIcon aria-hidden size={16} />{step.project.name}
      </button>
      <div className="model-list">
        {workspaces.type === "loading" && <p className="model-hint" role="status">Loading workspaces…</p>}
        {workspaces.type === "failed" && <p className="model-hint" role="alert">Workspaces unavailable: {workspaces.message}</p>}
        <ul>{workspaces.type === "ready" && workspaces.value.map((item) => {
          const name = item.branch ?? item.label;
          const label = workspaceLabel(step.project, item);
          return <li key={item.id}><button type="button" className="model-row destination-row" aria-current={binding.cwd === item.path || undefined}
            onClick={() => choose(item.path, label)}>
            <span className="model-row-name">{name}{item.isMain && <span className="model-row-variant">main checkout</span>}</span>
            <span className="model-row-meta"><span className="destination-path">{item.path}</span></span>
            {binding.cwd === item.path && <CheckIcon aria-hidden size={16} className="model-row-check" />}
          </button></li>;
        })}</ul>
      </div>
    </>}
  </div>;
}
