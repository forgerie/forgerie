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
