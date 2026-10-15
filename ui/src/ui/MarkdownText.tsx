// Adapted from assistant-ui's homepage MarkdownText. See THIRD_PARTY_NOTICES.md.
import { StreamdownTextPrimitive,
  type CodeHeaderProps, type SyntaxHighlighterProps, type StreamdownTextComponents } from "@assistant-ui/react-streamdown";
import { useAuiState } from "@assistant-ui/react";
import { memo, useCallback, useDeferredValue, useMemo } from "react";
import { CodeSheetHead } from "./CodeSheetHead";
import { CodeSheetBody } from "./CodeSheetBody";
import { fragmentRehypePlugins, markdownElements } from "./markdown/markdownPolicy";
import { useMarkdownLinkScope } from "./markdown/linkScope";
import { rehypeCallouts } from "./markdown/rehypeCallouts";
import { CalloutQuote, richBlocksByLanguage } from "./markdown/RichBlocks";
import { blockFences, noHeader } from "./markdown/blockFences";
import { FileTree, type FileLinks } from "./FileTree";

function CodeHeader({ language, code }: CodeHeaderProps) {
  return <CodeSheetHead language={language ?? ""} getText={() => code} />;
}

function SyntaxHighlighter({ code, language }: SyntaxHighlighterProps) {
  // Only highlight completed fences.
  const streaming = useAuiState((s) => s.part.status.type === "running");
  return <CodeSheetBody code={code} language={language ?? ""} highlight={!streaming} />;
}

const components: StreamdownTextComponents = { ...markdownElements, blockquote: CalloutQuote };
// Assign through the declared compatibility properties. The SDK's HTML index
// signature otherwise rejects its own narrower CodeHeader/SyntaxHighlighter types.
components.CodeHeader = CodeHeader;
components.SyntaxHighlighter = SyntaxHighlighter;
// Streamdown supplies GFM and unfinished-token repair. Keep our controls and
// CSS instead of its Tailwind controls, caret, or optional rendering plugins.
const remend = { linkMode: "text-only" as const };
const linkSafety = { enabled: false };
const componentsByLanguage = { ...richBlocksByLanguage, ...blockFences };

/** `fileLinks` makes each file in a `files` block that exists open on a tap. Keep it stable: a new object re-renders every block. */
export const MarkdownText = memo(function MarkdownText({ fileLinks }: { fileLinks?: FileLinks | undefined }) {
  const { origin } = useMarkdownLinkScope();
  const streaming = useAuiState((s) => s.part.status.type === "running");
  const text = useAuiState((s) => s.part.type === "text" || s.part.type === "reasoning" ? s.part.text : "");
  const deferredText = useDeferredValue(text);
  // Only live text may lag. Streamdown's `defer` also defers completed text on
  // Activity reveal; toggling it remounts rich blocks and loses open details.
  // Its preprocess seam lets the body keep its identity across completion.
  const preprocess = useCallback((current: string) => streaming ? deferredText : current, [streaming, deferredText]);
  // Resolve before hardening; only the final plugin can mark a callout.
  const rehypePlugins = useMemo(() => [...fragmentRehypePlugins(origin), rehypeCallouts], [origin]);
  const byLanguage = useMemo(() => fileLinks ? { ...componentsByLanguage,
    files: { SyntaxHighlighter: ({ code }: SyntaxHighlighterProps) => <FileTree code={code} links={fileLinks} />, CodeHeader: noHeader } }
    : componentsByLanguage, [fileLinks]);
  return <StreamdownTextPrimitive key={origin} containerClassName="markdown" className="markdown-content" components={components} controls={false}
    componentsByLanguage={byLanguage} rehypePlugins={rehypePlugins}
    remend={remend} linkSafety={linkSafety} skipHtml smooth={false} preprocess={preprocess} />;
});
