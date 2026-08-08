/**
 * Prototype shell. Composition only — every decision about *what state a
 * session is in* lives in the pure module `sessionBoard.js`.
 *
 * The point of the split: this file is throwaway, `sessionBoard.js` is not.
 */

import { loadFixtureWorld } from "./fixtures.js";
import {
  BOARD_GROUPS,
  attentionCount,
  deriveSessionBoard,
  groupSessionsByProject,
  relativeTime,
  triageQueue,
} from "./sessionBoard.js";

const NOW = Date.now();
const world = loadFixtureWorld(NOW);

const GROUP_BY_KIND = new Map(BOARD_GROUPS.map((group) => [group.kind, group]));

const state = {
  sessions: world.sessions,
  groupBy: "state",
  showArchived: false,
  // Calm default: only what wants something from you is open. The piles you are
  // still thinking about stay shut until you ask for them.
  collapsedGroups: new Set(["open", "archived"]),
  selectedId: "s-01",
  lastArchived: undefined,
};

const dom = {
  shell: document.querySelector(".shell"),
  summary: document.querySelector("#board-summary"),
  scroll: document.querySelector("#board-scroll"),
  thread: document.querySelector("#pane-thread"),
  toast: document.querySelector("#toast"),
  toastText: document.querySelector("#toast-text"),
  toastUndo: document.querySelector("#toast-undo"),
};

let toastTimer;

/* ------------------------------------------------------------- deriving -- */

function currentBoard() {
  const board = deriveSessionBoard({
    sessions: state.sessions,
    statuses: world.statuses,
    activities: world.activities,
    unreadSessionIds: world.unreadSessionIds,
    unreadCompletedAt: world.unreadCompletedAt,
    locationOf: world.locationOf,
  });
  return board;
}

function visibleGroups(board) {
  const groups = state.groupBy === "project"
    ? groupSessionsByProject(board, { includeArchived: state.showArchived }).groups
    : board.groups.filter((group) => state.showArchived || group.kind !== "archived");
  return groups.filter((group) => group.rows.length > 0);
}

function visibleRows(board) {
  return visibleGroups(board)
    .filter((group) => !state.collapsedGroups.has(group.kind))
    .flatMap((group) => group.rows);
}

function selectedRow(board) {
  return board.rows.find((row) => row.session.id === state.selectedId);
}

function toneVariable(kind) {
  return GROUP_BY_KIND.has(kind) ? `var(--tone-${kind})` : "var(--pi-dim)";
}

/* ------------------------------------------------------------ rendering -- */

function render() {
  const board = currentBoard();
  renderSummary(board);
  renderBoard(board);
  renderThread(board);
}

function renderSummary(board) {
  const needsYou = attentionCount(board);
  const working = board.counts.working;
  const open = board.counts.open;

  dom.summary.replaceChildren();
  // The group counts already say how many of what. The header only answers the
  // one question the counts cannot: is there anything for me at all?
  if (needsYou === 0) {
    dom.summary.append(text(working > 0 ? "nothing waiting" : "clear"));
    return;
  }
  const strong = document.createElement("strong");
  strong.textContent = String(needsYou);
  dom.summary.append(strong, text(" waiting"));
  void open;
}

function renderBoard(board) {
  const groups = visibleGroups(board);
  dom.scroll.replaceChildren();

  if (groups.length === 0) {
    dom.scroll.append(el("p", { class: "board-empty" }, "Inbox zero. Nothing left to work through."));
    return;
  }

  for (const group of groups) {
    dom.scroll.append(renderGroup(group, board));
  }
}

function renderGroup(group, board) {
  const collapsed = state.collapsedGroups.has(group.kind);
  const tone = state.groupBy === "project" ? "var(--pi-muted)" : toneVariable(group.kind);

  const header = el("button", {
    class: "group-header",
    style: `--group-tone: ${tone}`,
    "aria-expanded": String(!collapsed),
  });
  // No hint text: the group label plus the rows under it are the explanation.
  header.append(
    el("span", { class: "group-chevron" }, "▾"),
    el("span", { class: "group-label" }, group.label),
    el("span", { class: "group-count" }, String(group.rows.length)),
    el("span", { class: "group-spacer" }),
  );
  header.addEventListener("click", () => {
    toggleGroup(group.kind);
  });

  const rows = el("div", { class: "group-rows" });
  for (const row of group.rows) rows.append(renderRow(row, board));

  const section = el("section", { class: "group", "data-collapsed": String(collapsed) });
  section.append(header, rows);
  return section;
}

function renderRow(row, board) {
  const kind = row.state.kind;
  const node = el("div", {
    class: "row",
    role: "option",
    tabindex: "0",
    "data-state": kind,
    "data-session": row.session.id,
    style: `--row-tone: ${toneVariable(kind)}`,
    "aria-selected": String(row.session.id === state.selectedId),
  });

  const meta = el("div", { class: "row-meta" });
  if (row.session.parentSessionId !== undefined) meta.append(el("span", { class: "row-fork" }, "↳"));
  meta.append(locationChip(row.location));
  const detail = stateDetail(row.state);
  if (detail !== undefined) meta.append(el("span", { class: "row-detail" }, detail));

  const aside = el("div", { class: "row-aside" });
  aside.append(el("span", { class: "row-time" }, relativeTime(row.session.modified, NOW)));
  aside.append(rowActions(row));

  node.append(
    el("span", { class: "row-marker" }),
    el("div", { class: "row-title" }, row.session.firstMessage),
    meta,
    aside,
  );

  node.addEventListener("click", () => { select(row.session.id); });
  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(row.session.id);
    }
  });
  void board;
  return node;
}

function rowActions(row) {
  const actions = el("div", { class: "row-actions" });
  if (row.state.kind === "archived") {
    actions.append(actionButton("Restore", () => { setArchived(row.session.id, false); }));
    return actions;
  }
  // A glyph, not a word. The row is the content; the control should recede.
  actions.append(actionButton("✓", () => { archive(row.session.id); }, "Archive"));
  return actions;
}

function actionButton(label, onClick, title = label) {
  const button = el("button", { class: "row-action", title, "aria-label": title }, label);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function locationChip(location) {
  const chip = el("span", { class: "chip" });
  chip.append(text(location.projectName));
  if (!location.isMain) {
    chip.append(text(" · "), el("span", { class: "chip-branch" }, location.workspaceLabel));
  }
  return chip;
}

function stateDetail(boardState) {
  switch (boardState.kind) {
    case "blocked": return boardState.question;
    case "errored": return boardState.detail;
    case "working": return boardState.detail;
    default: return undefined;
  }
}

function renderThread(board) {
  const row = selectedRow(board);
  dom.thread.replaceChildren();

  if (row === undefined) {
    dom.thread.append(el("div", { class: "thread-placeholder" },
      el("strong", {}, "No session selected"),
      el("span", {}, "Pick something from the inbox.")));
    return;
  }

  const kind = row.state.kind;
  const group = GROUP_BY_KIND.get(kind);

  const back = el("button", { class: "back-to-board" }, "‹");
  back.addEventListener("click", () => { dom.shell.dataset.view = "board"; });

  const meta = el("div", { class: "thread-meta" });
  meta.append(el("span", { class: "state-badge", style: `--row-tone: ${toneVariable(kind)}` }, group.label));
  meta.append(locationChip(row.location));
  meta.append(el("span", {}, relativeTime(row.session.modified, NOW)));

  const heading = el("div", { class: "thread-heading" });
  heading.append(el("h2", { class: "thread-title" }, row.session.firstMessage), meta);

  const actions = el("div", { class: "thread-actions" });
  const archiveNext = el("button", { class: "button button-primary" }, "Archive & next");
  archiveNext.addEventListener("click", () => { archiveAndAdvance(row.session.id); });
  const hold = el("button", { class: "button" }, "Hold");
  hold.addEventListener("click", () => { advance(); });
  actions.append(hold, archiveNext);

  const header = el("header", { class: "thread-header" });
  header.append(back, heading, actions);

  dom.thread.append(header, renderTranscript(row), renderComposer());
}

function renderTranscript(row) {
  const scroll = el("div", { class: "thread-scroll" });

  scroll.append(bubble("user", "You", row.session.firstMessage));
  scroll.append(bubble("agent", "Agent",
    "Reading the relevant files now. This transcript is fixture content — the prototype is about the inbox, not the chat."));

  if (row.state.kind === "blocked") {
    const card = el("div", { class: "ask-card" });
    card.append(el("span", { class: "bubble-label" }, "Waiting on you"));
    card.append(el("div", {}, row.state.question));
    const options = el("div", { class: "ask-options" });
    options.append(el("button", { class: "button" }, "Option A"), el("button", { class: "button" }, "Option B"));
    card.append(options);
    scroll.append(card);
  } else if (row.state.kind === "errored") {
    scroll.append(bubble("agent", "Error", row.state.detail));
  } else if (row.state.kind === "working") {
    scroll.append(bubble("agent", "Running now", `${row.state.detail}…`));
  } else {
    scroll.append(bubble("agent", "Agent", "Done. Nothing is blocking; archive it or leave it open."));
  }

  return scroll;
}

function bubble(variant, label, body) {
  const node = el("div", { class: `bubble bubble-${variant}` });
  node.append(el("span", { class: "bubble-label" }, label), el("div", {}, body));
  return node;
}

function renderComposer() {
  const composer = el("div", { class: "composer" });
  const input = el("input", { class: "composer-input", type: "text", placeholder: "Reply to this session…" });
  composer.append(input, el("button", { class: "button button-primary" }, "Send"));
  return composer;
}

/* ---------------------------------------------------------- interaction -- */

function select(sessionId) {
  state.selectedId = sessionId;
  dom.shell.dataset.view = "thread";
  render();
}

function toggleGroup(kind) {
  if (state.collapsedGroups.has(kind)) state.collapsedGroups.delete(kind);
  else state.collapsedGroups.add(kind);
  render();
}

function setArchived(sessionId, archived) {
  state.sessions = state.sessions.map((session) => {
    if (session.id !== sessionId) return session;
    const next = { ...session };
    if (archived) {
      next.archived = true;
      next.archivedAt = new Date(NOW).toISOString();
    } else {
      delete next.archived;
      delete next.archivedAt;
    }
    return next;
  });
  render();
}

function archive(sessionId) {
  const board = currentBoard();
  const row = board.rows.find((candidate) => candidate.session.id === sessionId);
  setArchived(sessionId, true);
  showToast(`Archived “${truncate(row.session.firstMessage, 42)}”`, () => { setArchived(sessionId, false); });
}

/** Archive, then land on the next thing that wants you. The whole workflow, in one key. */
function archiveAndAdvance(sessionId) {
  const next = nextTriageTarget(sessionId);
  archive(sessionId);
  if (next !== undefined) state.selectedId = next;
  render();
}

function advance() {
  const next = nextTriageTarget(state.selectedId);
  if (next !== undefined) {
    state.selectedId = next;
    render();
  }
}

function nextTriageTarget(fromId) {
  const queue = triageQueue(currentBoard()).map((row) => row.session.id).filter((id) => id !== fromId);
  return queue[0];
}

function move(delta) {
  const board = currentBoard();
  const rows = visibleRows(board);
  if (rows.length === 0) return;
  const index = rows.findIndex((row) => row.session.id === state.selectedId);
  const nextIndex = Math.min(rows.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta));
  state.selectedId = rows[nextIndex].session.id;
  render();
  dom.scroll.querySelector(`[data-session="${state.selectedId}"]`)?.scrollIntoView({ block: "nearest" });
}

function showToast(message, onUndo) {
  clearTimeout(toastTimer);
  dom.toastText.textContent = message;
  dom.toast.hidden = false;
  dom.toastUndo.onclick = () => {
    dom.toast.hidden = true;
    onUndo();
  };
  toastTimer = setTimeout(() => { dom.toast.hidden = true; }, 5000);
}

function setGroupBy(mode) {
  state.groupBy = mode;
  for (const button of document.querySelectorAll("[data-group-by]")) {
    button.setAttribute("aria-pressed", String(button.dataset.groupBy === mode));
  }
  render();
}

function setShowArchived(showArchived) {
  state.showArchived = showArchived;
  document.querySelector("#toggle-archived").setAttribute("aria-pressed", String(showArchived));
  render();
}

/* ---------------------------------------------------------------- wiring -- */

for (const button of document.querySelectorAll("[data-group-by]")) {
  button.addEventListener("click", () => { setGroupBy(button.dataset.groupBy); });
}
document.querySelector("#toggle-archived").addEventListener("click", () => { setShowArchived(!state.showArchived); });

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey || event.altKey) return;
  switch (event.key.toLowerCase()) {
    case "j": event.preventDefault(); move(1); break;
    case "k": event.preventDefault(); move(-1); break;
    case "e": event.preventDefault(); archiveAndAdvance(state.selectedId); break;
    case "g": event.preventDefault(); setGroupBy(state.groupBy === "state" ? "project" : "state"); break;
    case "a": event.preventDefault(); setShowArchived(!state.showArchived); break;
    case "escape": dom.shell.dataset.view = "board"; break;
    default: break;
  }
});

/* ---------------------------------------------------------------- utils -- */

function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  for (const child of children) node.append(typeof child === "string" ? text(child) : child);
  return node;
}

function text(value) {
  return document.createTextNode(value);
}

function truncate(value, max) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

render();
