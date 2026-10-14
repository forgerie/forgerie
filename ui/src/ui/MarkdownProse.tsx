import { memo } from "react";
import { TextMessagePartProvider } from "@assistant-ui/react";
import { MarkdownText } from "./MarkdownText";
import type { FileLinks } from "./FileTree";

/**
 * Atom: a whole Markdown document outside a chat, drawn by the reply's own renderer, so it gets every block a reply
 * gets: callouts, steps, facts, files, details, code and the rest, under the same link policy. The text is complete:
 * nothing streams, so nothing is repaired.
 */
export const MarkdownProse = memo(function MarkdownProse({ text, fileLinks }: { text: string; fileLinks?: FileLinks | undefined }) {
  if (text.trim() === "") return null;
  return <TextMessagePartProvider text={text} isRunning={false}><MarkdownText fileLinks={fileLinks} /></TextMessagePartProvider>;
});
