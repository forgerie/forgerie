#!/usr/bin/env node
// A stand-in Forgerie API with fixture sessions, for reviewing session search
// (issue #37) before the server routes exist on this branch. It serves the
// catalog, the session reads, `/api/sessions/search` and
// `/api/sessions/:id/search-matches` by the approved contract, and empty
// answers elsewhere. It never touches a real session.
//
//   node scripts/search-fixture-server.mjs 8572
//   FORGERIE_API_URL=http://127.0.0.1:8572 npx vite --port 8571 --strictPort
//
// SEARCH_INDEX=building makes the index report that it is still being built.
// "Try two ways to cache the store" is read-only and its "deploy" match is off
// the branch, so it opens through GET /api/sessions/:id/tree.
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const port = Number(process.argv[2] ?? 8572);
const now = Date.now();
const ago = (minutes) => new Date(now - minutes * 60_000).toISOString();
const projects = [
  { id: "forgerie", name: "forgerie", path: "/code/forgerie" },
  { id: "kori", name: "kori", path: "/code/kori" },
];
const say = (role, text, extra = {}) => ({ role, text, ...extra });
/** Each session's current branch, in /messages order, and any entries on other branches. */
const sessions = [
  { id: "s-deploy", cwd: "/code/forgerie", name: "Fix the deploy script on zao", minutes: 42, messages: [
    say("user", "The deploy to zao failed again last night. Can you look at scripts/deploy.sh?"),
    say("assistant", "The deploy step fails when the Nix store is cold: the first `nix build` times out after 120 seconds, and the script exits without a retry."),
    say("user", "Make deploy retry once before it gives up, and log the attempt."),
    say("assistant", "Done. `deploy.sh` now retries the build once, waits 10 seconds between attempts, and writes each attempt to the journal with its exit code."),
    say("user", "Run it against the staging units first."),
    say("assistant", "The staging run passed on the second attempt. The first attempt hit the same cold-store timeout, so the retry is doing its job."),
    say("user", "Good. Ship it, then restart the user units so the running instance tracks main."),
    say("assistant", "Restarted forgerie-web.service and forgerie-sessiond.service. Both report active, and the deploy log shows one retry."),
  ], offBranch: [say("assistant", "On this branch the deploy keeps a warm copy of the store path, so a cold start costs one fetch.", { entryId: "s-deploy-off" })] },
  { id: "s-units", cwd: "/code/forgerie/.worktrees/units", name: "Restart the systemd user units after a merge", minutes: 26 * 60, messages: [
    say("user", "After a merge to main the units keep running the old build."),
    say("assistant", "I restarted forgerie-web.service and forgerie-sessiond.service. The deploy now tracks main without a NixOS rebuild."),
  ] },
  { id: "s-cache", cwd: "/code/forgerie", name: "Try two ways to cache the store", minutes: 3 * 24 * 60, readOnly: true, messages: [
    say("user", "Compare a warm store against a binary cache for the build."),
    say("assistant", "The binary cache wins for fresh machines; the warm store wins for repeat builds on zao."),
  ], offBranch: [say("assistant", "A blue-green deploy needs two ports, and the proxy has to switch between them.", { entryId: "s-cache-off" })] },
  { id: "s-ship", cwd: "/code/kori", name: "Ship 0.4 to the server", minutes: 40 * 24 * 60, archived: true, messages: [
    say("user", "Write the deploy notes for 0.4 and list what changed in the session daemon."),
    say("assistant", "Here are the notes. The session daemon now replays missed frames after a reconnect."),
  ] },
  { id: "s-search", cwd: "/code/forgerie", name: "Session search for the picker", minutes: 8, messages: [
    say("user", "Design the browser side of session search."),
    say("assistant", "A search field at the top of the list, hits with the matched passage, and a match bar in the session."),
  ] },
  { id: "s-tree", cwd: "/code/kori", name: "Untangle the tree navigator lenses", minutes: 5 * 60, messages: [
    say("user", "The tree opens on the user lens even when I want replies."),
    say("assistant", "The lens now widens to show the entry you asked for."),
  ] },
  { id: "s-notes", cwd: "/code/forgerie", name: "", minutes: 9 * 24 * 60, messages: [
    say("user", "Pin Node 24 in the deploy so the build is the same everywhere."),
    say("assistant", "Node 24 is pinned in flake.nix, and the deploy reads it from there."),
  ] },
];
const at = (index, session) => new Date(now - (session.minutes + (session.messages.length - index)) * 60_000).getTime();
const history = (session) => session.messages.map((message, index) => message.role === "user"
  ? { role: "user", content: message.text, timestamp: at(index, session) }
  : { role: "assistant", content: [{ type: "text", text: message.text }], timestamp: at(index, session), stopReason: "stop" });

/** The server's parser (parseSearchQuery in src/server/sessions/sessionSearchText.ts), line for line. */
function terms(query) {
  const found = [];
  let term = "";
  let quoted = false;
  for (let i = 0; i < query.length; i++) {
    const char = query[i];
    if (char === '"') {
      if (quoted && query[i + 1] === '"') { term += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && /\s/u.test(char ?? "")) {
      if (Array.from(term).length >= 3) found.push(term.toLowerCase());
      term = "";
    } else term += char ?? "";
  }
  if (Array.from(term).length >= 3) found.push(term.toLowerCase());
  return [...new Set(found)];
}
/** As the server cuts it: from 80 characters before the first match, 240 characters, every match marked. */
function passageOf(text, words) {
  const lower = text.toLowerCase();
  const first = Math.min(...words.map((word) => lower.indexOf(word)).filter((at) => at >= 0));
  const start = Math.max(0, first - 80);
  const cut = text.slice(start, start + 240);
  const marks = words.flatMap((word) => {
    const out = [];
    for (let at = lower.indexOf(word, start); at >= 0 && at < start + cut.length; at = lower.indexOf(word, at + 1)) out.push([at - start, Math.min(cut.length, at - start + word.length)]);
    return out;
  }).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const mark of marks) { const last = merged.at(-1); if (last && mark[0] <= last[1]) last[1] = Math.max(last[1], mark[1]); else merged.push(mark); }
  return { text: cut, marks: merged };
}
/**
 * As the server reads a session: a message matches when it holds any term, and
 * the session is a hit when its matching messages hold every term between them.
 */
function matchesOf(session, words) {
  const onBranch = session.messages.map((message, position) => ({ message, position, entryId: `${session.id}-${String(position)}`, offBranch: false }));
  const off = (session.offBranch ?? []).map((message) => ({ message, entryId: message.entryId, offBranch: true }));
  return [...onBranch, ...off].filter(({ message }) => words.some((word) => message.text.toLowerCase().includes(word)));
}
function search(url) {
  const words = terms(url.searchParams.get("q") ?? "");
  if (words.length === 0) return [400, { error: "Use at least one term with at least 3 characters", code: "query_too_short" }];
  const scope = url.searchParams.getAll("scope");
  const hits = sessions
    .filter((session) => scope.length === 0 || scope.some((folder) => session.cwd === folder || session.cwd.startsWith(`${folder}/`)))
    .flatMap((session) => {
      const found = matchesOf(session, words);
      if (!words.every((word) => found.some(({ message }) => message.text.toLowerCase().includes(word)))) return [];
      // The newest matching message: an off-branch entry counts when the branch has none.
      const newest = found.filter((match) => !match.offBranch).at(-1) ?? found.at(-1);
      return [{ sessionId: session.id, cwd: session.cwd, title: session.name, modified: ago(session.minutes), archived: session.archived === true,
        passage: { entryId: newest.entryId, role: newest.message.role, timestamp: ago(session.minutes), ...passageOf(newest.message.text, words) },
        otherMatches: found.length - 1, offBranch: newest.offBranch, minutes: session.minutes }];
    })
    .sort((a, b) => a.minutes - b.minutes)
    .map(({ minutes: _minutes, ...hit }) => hit);
  const building = process.env.SEARCH_INDEX === "building";
  return [200, { hits, index: { state: building ? "building" : "ready", indexedFiles: building ? 4210 : 13_719, totalFiles: 13_719 } }];
}

function treeOf(session) {
  const nodes = session.messages.map((message, index) => ({ id: `${session.id}-${String(index)}`, parentId: index === 0 ? null : `${session.id}-${String(index - 1)}`,
    kind: message.role, summary: message.text }));
  for (const message of session.offBranch ?? []) nodes.push({ id: message.entryId, parentId: `${session.id}-0`, kind: message.role, summary: message.text });
  const leaf = `${session.id}-${String(session.messages.length - 1)}`;
  return { nodes, activeLeafId: leaf, activePathIds: session.messages.map((_, index) => `${session.id}-${String(index)}`) };
}
const idle = { isStreaming: false, isCompacting: false, isBashRunning: false, queuedMessages: [] };
function route(method, url) {
  const path = url.pathname.replace(/^\/api\/machines\/local(?=\/sessions)/u, "/api");
  if (path === "/api/sessions/all") return [200, { statuses: [], activities: [], sessions: sessions.map((session) => ({ id: session.id, cwd: session.cwd,
    ...(session.name ? { name: session.name } : {}), modified: ago(session.minutes), ...(session.archived ? { archived: true } : {}) })) }];
  if (path === "/api/sessions/asks") return [200, { sessions: [] }];
  if (path === "/api/sessions/unread") return [200, { catalogId: "fixture", sessions: [] }];
  if (path === "/api/machines/local/projects" || path === "/api/projects") return [200, projects];
  if (path === "/api/project-groups") return [200, { groups: [], projects }];
  if (path === "/api/sessions/search") return search(url);
  const session = /^\/api\/sessions\/([^/]+)\/(.+)$/u.exec(path);
  const found = session ? sessions.find((item) => item.id === decodeURIComponent(session[1])) : undefined;
  if (session && found) {
    const action = session[2];
    if (action === "search-matches") {
      const words = terms(url.searchParams.get("q") ?? "");
      return [200, { matches: matchesOf(found, words).map((match) => ({ entryId: match.entryId, role: match.message.role, offBranch: match.offBranch,
        ...(match.offBranch ? {} : { position: match.position }) })) }];
    }
    if (action === "messages") { const messages = history(found); return [200, { messages, start: 0, total: messages.length }]; }
    if (action === "stream-snapshot") return [200, { partial: null, seq: 0 }];
    if (action === "status") return [200, { ...idle, ...(found.readOnly ? { readOnly: true } : {}) }];
    if (action === "commands") return [200, []];
    if (action === "unread/acknowledge") return [200, { catalogId: "fixture", sessions: [] }];
    if (action === "commands/run" && method === "POST") return [200, { type: "tree", tree: treeOf(found) }];
    // Reads the tree without running /tree, for a read-only session too.
    if (action === "tree" && method === "GET") return [200, { tree: treeOf(found) }];
  }
  if (session && !found && session[2] === "tree") return [404, { error: `Session ${decodeURIComponent(session[1])} was not found.` }];
  return [404, { error: `Not in the search fixture: ${method} ${url.pathname}` }];
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://fixture.local");
  const [status, body] = route(request.method ?? "GET", url);
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
});
// Every socket opens and stays quiet: no session is running.
const sockets = new WebSocketServer({ server });
sockets.on("connection", () => undefined);
server.listen(port, "127.0.0.1", () => process.stdout.write(`search fixture API on http://127.0.0.1:${String(port)}\n`));
