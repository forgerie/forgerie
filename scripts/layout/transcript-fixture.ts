/**
 * Mounts the real ChatView in a browser so its layout can be measured.
 *
 * The DOM-only test suite runs under happy-dom, which does no layout: it can
 * assert that a rule is present but not that the rule produces the right box.
 * The bug this fixture exists for -- a grid quietly stretching its rows -- is
 * invisible to every assertion that suite can make.
 *
 * States are named here rather than assembled by the runner, so the runner
 * measures boxes and does not also own what a transcript looks like.
 */
import { textMessage } from "../../src/client/src/chatMessages";
import { ChatView } from "../../src/client/src/components/ChatView";
import { selectedChatFreshReadable, selectedChatTarget } from "../../src/client/src/selectedChatLoad";

const session = { id: "layout-fixture", cwd: "/repo" };

/**
 * A table wider than any posture's reading column, so it always stacks.
 *
 * The cells deliberately mix inline content with prose -- code beside words,
 * a path long enough to wrap, a value short enough to look empty beside its
 * heading -- because a cell holding one plain word cannot show whether the
 * layout keeps a cell together.
 */
const WIDE_TABLE = [
  "Proposed shape, three tiers:",
  "",
  "| Tier | Source of truth | Who writes | Who reads | Delete from the page? |",
  "| --- | --- | --- | --- | --- |",
  "| system | `persona/skills/` in this repo | operator, by commit + deploy | every assistant | no |",
  "| shared | gateway-owned store, e.g. `~/.local/share/team-context-assistant/shared-skills/` | any signed-in person through the page | every assistant | yes, by rule below |",
  "| personal | the person's own assistant | that person | that person's assistant only | yes |",
  "",
  "How it works underneath: the gateway writes the record to its own store.",
  "",
  "| Tier | Undo |",
  "| --- | --- |",
  "| system | by commit |",
  "| shared | by rule |",
  "",
  "A table that fits is still a table: the two above are judged separately.",
].join("\n");

/**
 * Two columns of prose: the table that used to stack at every posture, because
 * a cell holding a sentence never fits that sentence on one line.
 */
const PROSE_TABLE = [
  "The first decision is which outcome matters most:",
  "",
  "| Outcome | What success means |",
  "| --- | --- |",
  "| Install another unit of a supported model. | Follow an established procedure without engineering work. |",
  "| Add a new device model. | Solve hardware support without rebuilding the product setup. |",
  "| Update an installed device. | Deliver, verify, and roll back through a consistent process. |",
  "",
  "**Which of these three is the main frustration?**",
].join("\n");

/** Six columns of short values: many fields, none of them a sentence. */
const SIX_COLUMN_TABLE = [
  "Three devices, and where each one stands:",
  "",
  "| Model | Boot | Drivers | Image | Verified | Owner |",
  "| --- | --- | --- | --- | --- | --- |",
  "| SM8550 | fastboot | in tree | 2026-09-12 | yes | Simon |",
  "| SM8650 | uefi | out of tree | 2026-09-04 | no | Korri |",
  "| MT8195 | u-boot | partial | 2026-08-28 | yes | unassigned |",
].join("\n");

const STATES: Record<string, (view: ChatView) => void> = {
  /** Fewer messages than the scroller can hold: the case that was stretching. */
  short: (view: ChatView) => {
    view.messages = [textMessage("user", "please continue"), textMessage("assistant", "Now the runtime tests back to MRU semantics.")];
    view.messageStart = 170;
    view.messageEnd = 172;
    view.messageTotal = 206;
    view.hasMore = true;
  },
  /** More messages than the scroller can hold, so the spacer must collapse. */
  tall: (view: ChatView) => {
    const messages = [];
    for (let index = 0; index < 40; index += 1) {
      messages.push(textMessage(index % 2 === 0 ? "user" : "assistant", `message ${String(index)} ${"word ".repeat(30)}`));
    }
    view.messages = messages;
    view.messageStart = 0;
    view.messageEnd = messages.length;
    view.messageTotal = messages.length;
    view.hasMore = true;
  },
  /** A table too wide for the reading column, which is laid out as records. */
  table: (view: ChatView) => {
    view.messages = [textMessage("user", "where should skills live?"), textMessage("assistant", WIDE_TABLE)];
    view.messageStart = 0;
    view.messageEnd = 2;
    view.messageTotal = 2;
    view.hasMore = false;
  },
  /** Two columns of prose, which fit as columns wherever the column is wide enough. */
  "prose-table": (view: ChatView) => {
    view.messages = [textMessage("user", "what are we deciding?"), textMessage("assistant", PROSE_TABLE)];
    view.messageStart = 0;
    view.messageEnd = 2;
    view.messageTotal = 2;
    view.hasMore = false;
  },
  /** Six short columns: the case where records pair their fields up. */
  "six-table": (view: ChatView) => {
    view.messages = [textMessage("user", "where do the three devices stand?"), textMessage("assistant", SIX_COLUMN_TABLE)];
    view.messageStart = 0;
    view.messageEnd = 2;
    view.messageTotal = 2;
    view.hasMore = false;
  },
  /** No transcript at all: the empty screen has to centre itself. */
  empty: (view: ChatView) => {
    view.messages = [];
    view.messageStart = 0;
    view.messageEnd = 0;
    view.messageTotal = 0;
    view.hasMore = false;
  },
};

async function mount(state: string): Promise<void> {
  const apply = STATES[state];
  if (apply === undefined) throw new Error(`Unknown transcript state ${JSON.stringify(state)}`);
  document.body.replaceChildren();
  const view = new ChatView();
  view.sessionId = session.id;
  view.selectedMachineId = "local";
  view.sessionCwd = session.cwd;
  view.selectedLoad = selectedChatFreshReadable(selectedChatTarget("local", session));
  apply(view);
  document.body.append(view);
  await view.updateComplete;
  // The transcript settles its scroll position on a later frame, so a measure
  // taken immediately after the update would read a position it does not keep.
  await new Promise((resolve) => { requestAnimationFrame(() => { requestAnimationFrame(resolve); }); });
}

declare global {
  interface Window {
    mountTranscript: (state: string) => Promise<void>;
    transcriptStates: readonly string[];
  }
}

window.mountTranscript = mount;
// The runner reads the case list from the model instead of keeping its own
// copy, so a new state cannot be added without being measured.
window.transcriptStates = Object.keys(STATES);
