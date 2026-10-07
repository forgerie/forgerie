// The real backlog view with GitHub issues, on fixtures. Not a drawing: these are the shipped
// components, so a capture shows what the app renders. No network.
// ?state=<name> renders one state at the page's real size.
// ?state=all renders every state, each in its own frame (an iframe, a real viewport);
// &size=<w>x<h> picks the frame size, folded portrait by default.
import { createRoot } from "react-dom/client";
import type { BacklogItem, BacklogList, BacklogWarning } from "../src/backlog/backlogApi";
import type { BacklogPlace } from "../src/backlog/backlogModel";
import type { GitHubAuthState } from "../src/backlog/githubApi";
import { AppShell } from "../src/ui/AppShell";
import { BacklogView, type BacklogBinding } from "../src/ui/backlog/BacklogView";
import "../src/ui/theme.css";
import "./github-backlog.css";

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const app = { clientId: "Iv23liForgerie01", slug: "forgerie-simonwjackson-zao" };
const base = { open: true, readiness: "ready" as const, blockingIds: [], blocked_by: [] };
const file = (id: string, title: string, priority: string, labels: string[], days: number): BacklogItem => ({ ...base, id, title, provider: "markdown", projectId: "p-korri",
  projectName: "korri", repo: "/home/simonwjackson/code/sandbox/korri", path: `.forgerie/backlog/${id}.md`, status: "To Do", priority, labels, created: ago(days) });
const issue = (n: number, title: string, labels: string[], days: number): BacklogItem => ({ ...base, id: String(n), title, provider: "github", projectId: "p-korri",
  projectName: "korri", repo: "/home/simonwjackson/code/sandbox/korri", path: `korri-os/korri#${String(n)}`, url: `https://github.com/korri-os/korri/issues/${String(n)}`,
  status: "Open", labels, created: ago(days) });
const forgerie = (id: string, title: string, priority: string, labels: string[], days: number): BacklogItem => ({ ...file(id, title, priority, labels, days),
  projectId: "p-forgerie", projectName: "forgerie", repo: "/home/simonwjackson/code/sandbox/forgerie", path: `work/items/parking-lot/${id}.md` });

const ITEMS: BacklogItem[] = [
  issue(212, "RG353M: audio drops after resume from suspend", ["bug", "rk3566"], 2),
  issue(208, "Steam Deck controller layout is mirrored in PortMaster games", ["input"], 6),
  issue(197, "Document the guest seed footprint limits for SD ext4", ["docs"], 19),
  file("task-026", "Persist guest SSH authorization across reflashes", "high", ["guest", "ssh"], 11),
  forgerie("01M2JYFC90DDHPPPVXWN33884M", "Make a delegated agent's nested transcript openable from the Agents panel", "high", ["agents-panel", "sessions"], 21),
];
const hidden: BacklogWarning = { projectId: "p-korri", provider: "github", path: "korri-os/korri", kind: "items-hidden",
  message: "3 issues from outside contributors are hidden, because their text goes to an agent. Set backlog.github.authors to \"all\" to list them." };
const needsLogin: BacklogWarning = { projectId: "p-korri", provider: "github", path: "korri-os/korri", kind: "provider-auth", message: "Connect GitHub to list issues for korri-os/korri." };
const ISSUE_BODY = "Audio stops after the device resumes from suspend. It comes back after a reboot.\n\n## Steps\n\n1. Play anything with sound.\n2. Suspend with the power button, wait ten seconds, resume.\n3. No sound until reboot.\n\n## Notes\n\n`dmesg` shows `rk817-codec: probe deferred` after resume. This started with the 2026-09-30 image.";

interface State { label: string; note: string; place: BacklogPlace; items: BacklogItem[]; warnings: BacklogWarning[]; github: GitHubAuthState }
const states: Record<string, State> = {
  list: { label: "Issues beside files", note: "GitHub issues sit in their project with their number. A note in the group says what GitHub left out.",
    place: {}, items: ITEMS, warnings: [hidden], github: { state: "connected", app, login: "simonwjackson" } },
  connect: { label: "Connect GitHub", note: "A project lists GitHub issues, and this machine has no login. The files still show.",
    place: {}, items: ITEMS.filter((item) => item.provider === "markdown"), warnings: [needsLogin], github: { state: "disconnected", app } },
  code: { label: "Code to enter", note: "After Connect: the code is the one thing to carry to GitHub. The page updates by itself.",
    place: {}, items: ITEMS.filter((item) => item.provider === "markdown"), warnings: [needsLogin],
    github: { state: "pending", app, userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device", expiresAt: new Date(Date.now() + 14 * 60_000).toISOString() } },
  setup: { label: "Not set up", note: "No GitHub App on this machine yet. The panel names the one command that sets it up.",
    place: {}, items: [], warnings: [needsLogin], github: { state: "not-configured" } },
  issue: { label: "An issue", note: "Links to GitHub, says a stranger may have written it, and starts a session like any item.",
    place: { item: { projectId: "p-korri", itemId: "212", provider: "github" } }, items: ITEMS, warnings: [], github: { state: "connected", app, login: "simonwjackson" } },
};

function Screen({ state }: { state: State }) {
  const list: BacklogList = { items: state.items, warnings: state.warnings, generatedAt: new Date().toISOString() };
  const binding: BacklogBinding = {
    load: { type: "ready", value: list }, onRefresh: () => undefined, onPlace: () => undefined, onLaunch: () => undefined, onOpenSession: () => undefined,
    look: () => undefined, onClose: () => undefined,
    api: {
      detail: (ref) => {
        const item = state.items.find((entry) => entry.id === ref.itemId && entry.provider === (ref.provider ?? "markdown"))!;
        return Promise.resolve({ item, body: ISSUE_BODY, initialPrompt: "" });
      },
      release: () => Promise.resolve({ released: true }),
    },
    github: { status: () => Promise.resolve(state.github), login: () => Promise.resolve(state.github), disconnect: () => Promise.resolve(state.github) },
  };
  return <AppShell open={false} onOpenChange={() => undefined} picker={() => null} thread={<BacklogView place={state.place} binding={binding} />} />;
}

function Sheet({ width, height }: { width: number; height: number }) {
  return <div className="mock-sheet" style={{ gridTemplateColumns: `repeat(auto-fill, ${String(width)}px)` }}>
    {Object.entries(states).map(([key, state]) => <figure key={key} className="mock-frame">
      <figcaption><strong>{state.label}</strong><span>{state.note}</span></figcaption>
      <iframe title={state.label} src={`?state=${key}`} width={width} height={height} className="mock-device" />
    </figure>)}
  </div>;
}

const params = new URLSearchParams(location.search);
const key = params.get("state") ?? "all";
const [width = 475, height = 638] = (params.get("size") ?? "475x638").split("x").map(Number);
const root = document.getElementById("root");
if (!root) throw new Error("Missing root");
if (key === "all") document.documentElement.classList.add("mock-sheet-page");
createRoot(root).render(key === "all" ? <Sheet width={width} height={height} /> : <Screen state={states[key] ?? states["list"]!} />);
