import { SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH, SESSION_TREE_TOOL_CALL_SUMMARY_PREFIX, type SessionTreeNode, type SessionTreeNodeKind, type SessionTreeSnapshot, type SessionTreeSummaryChoice } from "./sessionTree";

export interface SessionTreeModel {
  readonly nodesById: ReadonlyMap<string, SessionTreeNode>;
  readonly orderedIds: readonly string[];
  readonly rootIds: readonly string[];
  readonly parentById: ReadonlyMap<string, string | null>;
  readonly childrenById: ReadonlyMap<string, readonly string[]>;
  readonly depthById: ReadonlyMap<string, number>;
  readonly branchDepthById: ReadonlyMap<string, number>;
  readonly activePathIds: ReadonlySet<string>;
  readonly activeLeafId: string | null;
}

/**
 * How a row meets its lane. Only a fork's direct children get an elbow:
 * "branch" when siblings follow it, "last" when it closes the fork.
 */
export type SessionTreeConnector = "none" | "branch" | "last";

export interface SessionTreeRow {
  readonly node: SessionTreeNode;
  readonly depth: number;
  readonly branchDepth: number;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly activePath: boolean;
  readonly activeLeaf: boolean;
  /** Per lane, whether that fork still has rows below this one to reach. */
  readonly rails: readonly boolean[];
  readonly connector: SessionTreeConnector;
}

/**
 * Reading lenses over one history, mirroring the Pi TUI's tree filters.
 * "conversation" is the TUI's "default": prose and tools without bookkeeping.
 */
export type SessionTreeFilterMode = "user-only" | "no-tools" | "conversation" | "labeled-only" | "all";

export interface SessionTreeFilterOption {
  readonly mode: SessionTreeFilterMode;
  readonly label: string;
  readonly description: string;
}

/** Presentation order, narrowest lens first. */
export const SESSION_TREE_FILTER_OPTIONS: readonly SessionTreeFilterOption[] = [
  { mode: "user-only", label: "User", description: "Only your messages" },
  { mode: "no-tools", label: "No tools", description: "Conversation without tool results" },
  { mode: "conversation", label: "Conversation", description: "Prose and tool results, no bookkeeping" },
  { mode: "labeled-only", label: "Labeled", description: "Only labeled entries" },
  { mode: "all", label: "All", description: "Every retained entry" },
];

/**
 * Navigating usually means "go back to something I asked", and a user message is
 * the only entry whose text returns to the composer. The narrow lens is the
 * useful first screen; the TUI instead opens on its "conversation" lens.
 */
export const SESSION_TREE_DEFAULT_FILTER: SessionTreeFilterMode = "user-only";

/** Bookkeeping entries: settings and housekeeping, never conversation. */
const SESSION_TREE_BOOKKEEPING_KINDS: ReadonlySet<SessionTreeNodeKind> = new Set<SessionTreeNodeKind>([
  "label",
  "custom",
  "model-change",
  "thinking-level-change",
  "session-info",
]);

export interface SessionTreeViewState {
  readonly foldedIds: ReadonlySet<string>;
  readonly filter: SessionTreeFilterMode;
  /** Whitespace-separated terms, all of which must appear in an entry. */
  readonly search?: string;
}

export interface SessionTreeView {
  readonly rows: readonly SessionTreeRow[];
  /** Nearest retained ancestor per visible node, so filtering never orphans a row. */
  readonly visibleParentById: ReadonlyMap<string, string | null>;
  readonly visibleChildrenById: ReadonlyMap<string, readonly string[]>;
}

export interface SessionTreeKeyState {
  readonly selectedId: string | undefined;
  readonly foldedIds: ReadonlySet<string>;
  readonly filter?: SessionTreeFilterMode;
  readonly search?: string;
}

export interface SessionTreeKeyTransition extends SessionTreeKeyState {
  readonly handled: boolean;
  readonly action?: "confirm" | "cancel";
}

export type SessionTreeSummaryValidation =
  | { readonly ok: true; readonly choice: SessionTreeSummaryChoice }
  | { readonly ok: false; readonly error: string };

/**
 * Turn the strict flat transport projection into a safe forest. Parent links to
 * missing nodes become roots, and the edge that would close a cycle is detached.
 */
export function buildSessionTreeModel(snapshot: SessionTreeSnapshot): SessionTreeModel {
  const nodesById = new Map<string, SessionTreeNode>();
  const orderedIds: string[] = [];
  for (const node of snapshot.nodes) {
    // Runtime projections use unique IDs. Keeping the first occurrence makes a
    // malformed duplicate deterministic without creating duplicate treeitems.
    if (nodesById.has(node.id)) continue;
    nodesById.set(node.id, node);
    orderedIds.push(node.id);
  }

  const parentById = normalizedSessionTreeParents(nodesById, orderedIds);

  const mutableChildren = new Map<string, string[]>();
  for (const id of orderedIds) mutableChildren.set(id, []);
  const rootIds: string[] = [];
  for (const id of orderedIds) {
    const parentId = parentById.get(id) ?? null;
    if (parentId === null) {
      rootIds.push(id);
      continue;
    }
    mutableChildren.get(parentId)?.push(id);
  }

  const depthById = new Map<string, number>();
  const branchDepthById = new Map<string, number>();
  const visited = new Set<string>();
  const stack = [...rootIds].reverse().map((id) => ({ id, depth: 0, branchDepth: 0 }));
  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined || visited.has(next.id)) continue;
    visited.add(next.id);
    depthById.set(next.id, next.depth);
    branchDepthById.set(next.id, next.branchDepth);
    const children = mutableChildren.get(next.id) ?? [];
    // Session entries form very deep linear chains. Only forks need another
    // visual lane; indenting every parent would push ordinary history off-screen.
    const childBranchDepth = next.branchDepth + (children.length > 1 ? 1 : 0);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const childId = children[index];
      if (childId !== undefined) stack.push({ id: childId, depth: next.depth + 1, branchDepth: childBranchDepth });
    }
  }

  // The normalized parent map should already make every node reachable. This
  // fallback keeps the UI complete if future input violates that invariant.
  for (const id of orderedIds) {
    if (visited.has(id)) continue;
    rootIds.push(id);
    parentById.set(id, null);
    depthById.set(id, 0);
    branchDepthById.set(id, 0);
  }

  const childrenById = new Map<string, readonly string[]>();
  for (const [id, children] of mutableChildren) childrenById.set(id, children);
  const activeLeafId = snapshot.activeLeafId !== null && nodesById.has(snapshot.activeLeafId) ? snapshot.activeLeafId : null;
  // Re-derive the path from the normalized forest. A malformed remote snapshot
  // cannot badge an unrelated branch or keep a cycle-closing edge active.
  const activePathIds = activeLeafId === null ? new Set<string>() : sessionTreeAncestorIds(activeLeafId, parentById);

  return { nodesById, orderedIds, rootIds, parentById, childrenById, depthById, branchDepthById, activePathIds, activeLeafId };
}

/**
 * Project the model through a reading lens. Hidden entries do not orphan their
 * descendants: every retained node re-attaches to its nearest retained
 * ancestor, and indentation is recomputed over that visible forest, so a lens
 * change never drifts the tree rightward.
 */
export function sessionTreeView(model: SessionTreeModel, state: SessionTreeViewState): SessionTreeView {
  const terms = searchTerms(state.search ?? "");
  const retained = new Set<string>();
  for (const id of model.orderedIds) {
    const node = model.nodesById.get(id);
    if (node === undefined) continue;
    if (!retainsSessionTreeNode(node, state.filter, model.activeLeafId)) continue;
    if (!matchesSessionTreeSearch(node, terms)) continue;
    retained.add(id);
  }

  const visibleParentById = new Map<string, string | null>();
  const mutableChildren = new Map<string, string[]>();
  const visibleRootIds: string[] = [];
  // orderedIds is pre-order, so children keep their sibling order here.
  for (const id of model.orderedIds) {
    if (!retained.has(id)) continue;
    let ancestorId = model.parentById.get(id) ?? null;
    while (ancestorId !== null && !retained.has(ancestorId)) ancestorId = model.parentById.get(ancestorId) ?? null;
    visibleParentById.set(id, ancestorId);
    if (ancestorId === null) {
      visibleRootIds.push(id);
      continue;
    }
    const siblings = mutableChildren.get(ancestorId);
    if (siblings === undefined) mutableChildren.set(ancestorId, [id]);
    else siblings.push(id);
  }

  // At a fork, the branch you are actually on reads first. Sibling order is
  // otherwise transport order, which buries the live branch under abandoned ones.
  for (const [, siblings] of mutableChildren) {
    if (siblings.length < 2) continue;
    const active = siblings.filter((id) => model.activePathIds.has(id));
    if (active.length === 0 || active.length === siblings.length) continue;
    const rest = siblings.filter((id) => !model.activePathIds.has(id));
    siblings.splice(0, siblings.length, ...active, ...rest);
  }

  interface PendingRow {
    readonly id: string;
    readonly depth: number;
    readonly rails: readonly boolean[];
    readonly connector: SessionTreeConnector;
  }

  const rows: SessionTreeRow[] = [];
  const visited = new Set<string>();
  const stack: PendingRow[] = [...visibleRootIds].reverse().map((id) => ({ id, depth: 0, rails: [], connector: "none" as const }));
  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined || visited.has(next.id)) continue;
    const node = model.nodesById.get(next.id);
    if (node === undefined) continue;
    visited.add(next.id);
    const childIds = mutableChildren.get(next.id) ?? [];
    rows.push({
      node,
      depth: next.depth,
      branchDepth: next.rails.length,
      parentId: visibleParentById.get(next.id) ?? null,
      childIds,
      activePath: model.activePathIds.has(next.id),
      activeLeaf: model.activeLeafId === next.id,
      rails: next.rails,
      connector: next.connector,
    });
    if (state.foldedIds.has(next.id)) continue;
    for (let index = childIds.length - 1; index >= 0; index -= 1) {
      const childId = childIds[index];
      if (childId === undefined) continue;
      const isLast = index === childIds.length - 1;
      // Only a fork earns another lane, exactly as buildSessionTreeModel does.
      // A single-child chain inherits its parent's lanes and draws no elbow, so
      // ordinary history never marches rightward.
      stack.push(childIds.length > 1
        ? { id: childId, depth: next.depth + 1, rails: [...next.rails, !isLast], connector: isLast ? "last" : "branch" }
        : { id: childId, depth: next.depth + 1, rails: next.rails, connector: "none" });
    }
  }

  const visibleChildrenById = new Map<string, readonly string[]>();
  for (const [id, children] of mutableChildren) visibleChildrenById.set(id, children);
  return { rows, visibleParentById, visibleChildrenById };
}

export function visibleSessionTreeRows(
  model: SessionTreeModel,
  foldedIds: ReadonlySet<string>,
  filter: SessionTreeFilterMode = "all",
  search = "",
): SessionTreeRow[] {
  return [...sessionTreeView(model, { foldedIds, filter, search }).rows];
}

/** Everything a reader can reasonably expect a search over the tree to match. */
export function sessionTreeSearchText(node: SessionTreeNode): string {
  return `${node.label ?? ""} ${node.kind} ${node.summary}`.toLowerCase();
}

function searchTerms(search: string): readonly string[] {
  return search.toLowerCase().split(/\s+/u).filter((term) => term !== "");
}

function matchesSessionTreeSearch(node: SessionTreeNode, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const text = sessionTreeSearchText(node);
  return terms.every((term) => text.includes(term));
}

/**
 * Repair a selection after a lens change by walking up the original parent
 * chain, so the cursor lands on the retained entry that contains the old one.
 */
export function nearestVisibleSessionTreeId(
  model: SessionTreeModel,
  visibleIds: readonly string[],
  selectedId: string | undefined,
): string | undefined {
  if (visibleIds.length === 0) return undefined;
  const visible = new Set(visibleIds);
  let currentId = selectedId;
  while (currentId !== undefined) {
    if (visible.has(currentId)) return currentId;
    currentId = model.parentById.get(currentId) ?? undefined;
  }
  return visibleIds.at(-1);
}

function retainsSessionTreeNode(node: SessionTreeNode, filter: SessionTreeFilterMode, activeLeafId: string | null): boolean {
  // A tool-call-only assistant turn is scaffolding around the tool result that
  // follows it, so it stays hidden in every lens. The active leaf is exempt:
  // the cursor's own position must always be reachable.
  if (
    node.kind === "assistant"
    && node.id !== activeLeafId
    && node.summary.startsWith(SESSION_TREE_TOOL_CALL_SUMMARY_PREFIX)
  ) return false;

  switch (filter) {
    case "user-only":
      return node.kind === "user";
    case "no-tools":
      return !SESSION_TREE_BOOKKEEPING_KINDS.has(node.kind) && node.kind !== "tool-result";
    case "conversation":
      return !SESSION_TREE_BOOKKEEPING_KINDS.has(node.kind);
    case "labeled-only":
      return node.label !== undefined;
    case "all":
      return true;
  }
}

export function initialSessionTreeSelection(model: SessionTreeModel): string | undefined {
  if (model.activeLeafId !== null) return model.activeLeafId;
  return model.orderedIds.at(-1);
}

export function transitionSessionTreeKey(model: SessionTreeModel, state: SessionTreeKeyState, key: string): SessionTreeKeyTransition {
  const view = sessionTreeView(model, { foldedIds: state.foldedIds, filter: state.filter ?? "all", search: state.search ?? "" });
  const rows = view.rows;
  const visibleIds = rows.map((row) => row.node.id);
  const selectedId = normalizedVisibleSelection(visibleIds, state.selectedId);
  const selectedIndex = selectedId === undefined ? -1 : visibleIds.indexOf(selectedId);
  const unchanged = (): SessionTreeKeyTransition => ({ ...state, selectedId, handled: false });
  const select = (nextSelectedId: string | undefined): SessionTreeKeyTransition => ({ ...state, selectedId: nextSelectedId, handled: true });

  switch (key) {
    case "ArrowUp":
      return select(selectedIndex > 0 ? visibleIds[selectedIndex - 1] : selectedId);
    case "ArrowDown":
      return select(selectedIndex >= 0 && selectedIndex < visibleIds.length - 1 ? visibleIds[selectedIndex + 1] : selectedId);
    case "Home":
      return select(visibleIds[0]);
    case "End":
      return select(visibleIds.at(-1));
    case "ArrowLeft": {
      if (selectedId === undefined) return select(undefined);
      const children = view.visibleChildrenById.get(selectedId) ?? [];
      if (children.length > 0 && !state.foldedIds.has(selectedId)) {
        const foldedIds = new Set(state.foldedIds);
        foldedIds.add(selectedId);
        return { ...state, selectedId, foldedIds, handled: true };
      }
      return select(view.visibleParentById.get(selectedId) ?? selectedId);
    }
    case "ArrowRight": {
      if (selectedId === undefined) return select(undefined);
      const children = view.visibleChildrenById.get(selectedId) ?? [];
      if (children.length === 0) return select(selectedId);
      if (state.foldedIds.has(selectedId)) {
        const foldedIds = new Set(state.foldedIds);
        foldedIds.delete(selectedId);
        return { ...state, selectedId, foldedIds, handled: true };
      }
      return select(children[0]);
    }
    case "Enter":
      return { ...state, selectedId, handled: true, ...(selectedId === undefined ? {} : { action: "confirm" }) };
    case "Escape":
      return { ...state, selectedId, handled: true, action: "cancel" };
    default:
      return unchanged();
  }
}

export function toggleSessionTreeFold(model: SessionTreeModel, state: SessionTreeKeyState, id: string): SessionTreeKeyState {
  const view = sessionTreeView(model, { foldedIds: state.foldedIds, filter: state.filter ?? "all", search: state.search ?? "" });
  const children = view.visibleChildrenById.get(id) ?? [];
  if (children.length === 0) return { ...state, selectedId: id };
  const foldedIds = new Set(state.foldedIds);
  if (foldedIds.has(id)) foldedIds.delete(id);
  else foldedIds.add(id);
  return { ...state, selectedId: id, foldedIds };
}

export function validateSessionTreeSummaryChoice(mode: SessionTreeSummaryChoice["mode"], customInstructions: string): SessionTreeSummaryValidation {
  if (mode === "none" || mode === "default") return { ok: true, choice: { mode } };
  if (customInstructions.trim() === "") return { ok: false, error: "Enter custom summary focus instructions." };
  if (customInstructions.length > SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH) {
    return { ok: false, error: `Custom summary focus must be ${String(SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH)} characters or fewer.` };
  }
  return { ok: true, choice: { mode: "custom", instructions: customInstructions.trim() } };
}

function normalizedSessionTreeParents(
  nodesById: ReadonlyMap<string, SessionTreeNode>,
  orderedIds: readonly string[],
): Map<string, string | null> {
  const parentById = new Map<string, string | null>();
  for (const id of orderedIds) {
    const candidate = nodesById.get(id)?.parentId ?? null;
    parentById.set(id, candidate !== null && candidate !== id && nodesById.has(candidate) ? candidate : null);
  }

  // Parent links form a functional graph. Resolve each chain once and detach
  // the edge that first closes a cycle, keeping normalization linear for large,
  // deeply nested histories.
  const stateById = new Map<string, "visiting" | "visited">();
  for (const startId of orderedIds) {
    if (stateById.has(startId)) continue;
    const path: string[] = [];
    let currentId: string | null = startId;
    while (currentId !== null && !stateById.has(currentId)) {
      stateById.set(currentId, "visiting");
      path.push(currentId);
      currentId = parentById.get(currentId) ?? null;
    }
    if (currentId !== null && stateById.get(currentId) === "visiting") {
      const cycleClosingId = path.at(-1);
      if (cycleClosingId !== undefined) parentById.set(cycleClosingId, null);
    }
    for (const id of path) stateById.set(id, "visited");
  }
  return parentById;
}

function sessionTreeAncestorIds(activeLeafId: string, parentById: ReadonlyMap<string, string | null>): Set<string> {
  const ids = new Set<string>();
  let currentId: string | null = activeLeafId;
  while (currentId !== null && !ids.has(currentId)) {
    ids.add(currentId);
    currentId = parentById.get(currentId) ?? null;
  }
  return ids;
}

function normalizedVisibleSelection(visibleIds: readonly string[], selectedId: string | undefined): string | undefined {
  if (selectedId !== undefined && visibleIds.includes(selectedId)) return selectedId;
  return visibleIds.at(-1);
}

const MAX_SESSION_TREE_VISUAL_DEPTH = 8;

/** Lanes drawn for a row. Deeper forks share the last lane, so rows never leave the dialog. */
export function sessionTreeVisualDepth(depth: number): number {
  return Math.min(Math.max(0, depth), MAX_SESSION_TREE_VISUAL_DEPTH);
}

/** Continuing from these entries puts their text back in the composer. */
export function sessionTreeEntryReturnsToEditor(kind: SessionTreeNodeKind): boolean {
  return kind === "user" || kind === "custom-message";
}

const SESSION_TREE_KIND_LABELS = {
  user: "User", assistant: "Assistant", "tool-result": "Tool result", bash: "Shell", "custom-message": "Custom message",
  compaction: "Compaction", "branch-summary": "Branch summary", "model-change": "Model", "thinking-level-change": "Thinking",
  "session-info": "Session info", label: "Label", custom: "Custom", other: "Other",
} as const satisfies Record<SessionTreeNodeKind, string>;

export function sessionTreeKindLabel(kind: SessionTreeNodeKind): string {
  return SESSION_TREE_KIND_LABELS[kind];
}

export function isSessionTreeBookkeeping(kind: SessionTreeNodeKind): boolean {
  return SESSION_TREE_BOOKKEEPING_KINDS.has(kind);
}

/**
 * The active-path entries that would leave the active path if the selection
 * became the active leaf. The navigator fades them, so the consequence shows
 * before the user chooses.
 */
export function sessionTreeAbandonedPreviewIds(tree: SessionTreeSnapshot, selectedId: string | undefined): ReadonlySet<string> {
  if (selectedId === undefined) return new Set();
  const parentById = new Map<string, string | null>();
  for (const node of tree.nodes) parentById.set(node.id, node.parentId);
  if (!parentById.has(selectedId)) return new Set();
  const kept = new Set<string>();
  let cursor: string | null = selectedId;
  while (cursor !== null && !kept.has(cursor)) {
    kept.add(cursor);
    cursor = parentById.get(cursor) ?? null;
  }
  return new Set(tree.activePathIds.filter((id) => !kept.has(id)));
}
