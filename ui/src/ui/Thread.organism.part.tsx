import { useCallback, useEffect, useRef, useState } from "react";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import type { EarlierHistory } from "../historyPaging";
import type { TranscriptMessage } from "../transcript";
import { useThreadMessages } from "../useThreadMessages";
import { HeaderButton } from "./HeaderButton";
import { SessionFrame } from "./SessionFrame";
import { Thread } from "./Thread";

export const name = "Thread";
export const note = "The conversation with earlier history paged in above it: available, loading, failed with retry, and the start of the chat";
export const checks = {
  default: {
    "the keyboard loads the page above the first message": async ({ canvas, input, expect, waitFor }) => {
      await input.press(canvas.getByRole("button", { name: "load earlier messages" }), "Enter");
      await waitFor(() => { expect(canvas.getByText("What happens to my place when they load?")).toBeVisible(); });
    },
  },
  Failed: {
    "retry loads the page that failed": async ({ canvas, input, expect, waitFor }) => {
      expect(canvas.getByRole("alert")).toHaveTextContent("could not load earlier messages");
      await input.click(canvas.getByRole("button", { name: "retry" }));
      await waitFor(() => { expect(canvas.getByText("What happens to my place when they load?")).toBeVisible(); });
      expect(canvas.queryByRole("alert")).toBeNull();
    },
  },
} satisfies StateChecks;

/** How long a page takes to arrive. Long enough to see the loading seam. */
const PAGE_DELAY_MS = 700;
const STREAM_TICK_MS = 120;
const STREAM_PARAGRAPHS = 60;

const say = (id: string, role: "user" | "assistant", text: string): TranscriptMessage => ({ id, role, parts: [{ type: "text", text }] });

/** A short history: each page is one question and its answer, so the seam stays in view at every size. */
const shortPages: readonly (readonly TranscriptMessage[])[] = [
  [say("u1", "user", "Where does the session open?"), say("a1", "assistant", "At the newest complete turn. Older turns load above it on request.")],
  [say("u2", "user", "What happens to my place when they load?"), say("a2", "assistant", "The message you were reading stays where it was. The older turns arrive above it.")],
  [say("u3", "user", "Can the seam stay readable on the cover screen?"), say("a3", "assistant", "It keeps one quiet line, and the button keeps a full touch target.")],
];

/**
 * The fast-chat-open fixture's shape: every turn reads six files, then answers
 * with a 60-line TypeScript block and a Mermaid diagram. A page is six turns,
 * as the server's 50-message first page expands to a turn boundary.
 */
function fixtureTurn(turn: number): TranscriptMessage[] {
  const code = Array.from({ length: 60 }, (_, line) => `export const value${line} = { turn: ${turn}, line: ${line}, label: "deterministic fixture" };`).join("\n");
  return [
    say(`user-${turn}`, "user", `Inspect turn ${turn}.`),
    { id: `assistant-tools-${turn}`, role: "assistant", parts: Array.from({ length: 6 }, (_, slot) => ({ type: "tool" as const, id: `tool-${turn}-${slot}`, name: "read",
      args: { path: "src/session.ts" }, state: { type: "done" as const, output: `Output ${slot}: ${"file content\n".repeat(20)}`, isError: false } })) },
    say(`assistant-${turn}`, "assistant", `Turn ${turn}: inspect the session loading path.\n\n\`\`\`typescript\n${code}\n\`\`\`\n\n` +
      "```mermaid\ngraph LR\n  Picker --> Store\n  Store --> History\n  History --> Transcript\n```\n\n" + `Readable last turn ${turn}.`),
  ];
}
const FIXTURE_TURNS = 1500;
const TURNS_PER_PAGE = 6;
function fixturePage(last: number): TranscriptMessage[] {
  const count = Math.min(TURNS_PER_PAGE, last);
  return Array.from({ length: count }, (_, index) => fixtureTurn(last - count + 1 + index)).flat();
}

function streamedReply(id: string, paragraphs: number): TranscriptMessage {
  return say(id, "assistant", Array.from({ length: paragraphs }, (_, index) => `Streamed paragraph ${index + 1}. The reply grows at the end while the history above it stays still.`).join("\n\n"));
}

/**
 * A local store with the session store's paging contract: messages keep their
 * identity, older pages arrive above them, and `onLoadEarlier` settles only
 * after the prepend is drawn. Sending a message streams a reply.
 */
function Scenario({ title, first, earlier: start, older, hits }: {
  title: string;
  /** Message ids a search would step through; the header's action reveals the next one, as a search does. */
  hits?: readonly string[] | undefined;
  first: readonly TranscriptMessage[];
  earlier?: EarlierHistory | undefined;
  /** The pages above `first`, nearest first. An undefined page means the history ends. */
  older?: ((page: number) => readonly TranscriptMessage[] | undefined) | undefined;
}) {
  const [messages, setMessages] = useState<readonly TranscriptMessage[]>(first);
  const [earlier, setEarlier] = useState<EarlierHistory | undefined>(start);
  const [running, setRunning] = useState(false);
  const [hit, setHit] = useState<number>();
  const loaded = useRef(0);
  const drawn = useRef<(() => void) | undefined>(undefined);
  useEffect(() => { drawn.current?.(); drawn.current = undefined; }, [messages, earlier]);
  const onLoadEarlier = useCallback(async () => {
    setEarlier({ type: "loading" });
    await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
    const page = older?.(loaded.current);
    loaded.current += 1;
    const more = older?.(loaded.current) !== undefined;
    await new Promise<void>((resolve) => {
      drawn.current = resolve;
      if (page) setMessages((current) => [...page, ...current]);
      setEarlier(more ? { type: "available" } : { type: "complete" });
    });
  }, [older]);
  const streams = useRef(0);
  const onNew = useCallback(async () => {
    const turn = ++streams.current;
    const replyId = `stream-reply-${turn}`;
    setMessages((current) => [...current, say(`stream-question-${turn}`, "user", "Stream a reply while the history stays still."), streamedReply(replyId, 1)]);
    setRunning(true);
    for (let paragraphs = 2; paragraphs <= STREAM_PARAGRAPHS; paragraphs++) {
      await new Promise((resolve) => setTimeout(resolve, STREAM_TICK_MS));
      setMessages((current) => current.map((message) => message.id === replyId ? streamedReply(replyId, paragraphs) : message));
    }
    setRunning(false);
  }, []);
  const threadMessages = useThreadMessages(messages, running);
  const runtime = useExternalStoreRuntime({ messages: threadMessages, isRunning: running, onNew, onCancel: async () => undefined,
    hasEarlier: earlier !== undefined && earlier.type !== "complete", onLoadEarlier: earlier === undefined ? undefined : onLoadEarlier });
  const reveal = hits && hit !== undefined ? { messageId: hits[hit % hits.length]!, key: String(hit) } : undefined;
  return <AssistantRuntimeProvider runtime={runtime}>
    <SessionFrame name={title} actions={hits && <HeaderButton label="Next search hit" onPress={() => setHit((current) => (current ?? -1) + 1)} />}>
      <Thread earlier={earlier} reveal={reveal} />
    </SessionFrame>
  </AssistantRuntimeProvider>;
}

const shortOlder = (page: number) => shortPages[shortPages.length - 2 - page];
const fixtureOlder = (page: number) => {
  const last = FIXTURE_TURNS - TURNS_PER_PAGE * (page + 1);
  return last > 0 ? fixturePage(last) : undefined;
};
const newest = shortPages.at(-1)!;

/** Older messages wait above the newest turn. */
export default function Available() {
  return <Scenario title="Paging" first={newest} earlier={{ type: "available" }} older={shortOlder} />;
}
export function Loading() {
  return <Scenario title="Paging" first={newest} earlier={{ type: "loading" }} older={shortOlder} />;
}
export function Failed() {
  return <Scenario title="Paging" first={newest} earlier={{ type: "failed", message: "the server did not answer." }} older={shortOlder} />;
}
export function StartOfChat() {
  return <Scenario title="Paging" first={shortPages.flat()} earlier={{ type: "complete" }} />;
}
/** A thread without paging, such as a new session: no seam at all. */
export function NoPaging() {
  return <Scenario title="Paging" first={newest} />;
}
/**
 * The fast-chat-open huge fixture's newest page, with 1494 more turns above it. Sending a message streams a reply.
 * Next search hit reveals turns 1499, 1484 and 1490 in turn, once those pages are loaded.
 */
export function Paging() {
  return <Scenario title="Huge fixture" first={fixturePage(FIXTURE_TURNS)} earlier={{ type: "available" }} older={fixtureOlder}
    hits={["user-1499", "user-1484", "user-1490"]} />;
}
