// Adapted from assistant-ui's homepage MarkdownText. See THIRD_PARTY_NOTICES.md.
import { StreamdownTextPrimitive,
  type CodeHeaderProps, type SyntaxHighlighterProps, type StreamdownTextComponents } from "@assistant-ui/react-streamdown";
import { useAuiState } from "@assistant-ui/react";
import { memo, useMemo } from "react";
import { CopyButton } from "./CopyButton";
import { highlightCode } from "./highlightCode";
import { fragmentRehypePlugins, markdownElements } from "./markdown/markdownPolicy";
import { useMarkdownLinkScope } from "./markdown/linkScope";
import { rehypeCallouts } from "./markdown/rehypeCallouts";
import { CalloutQuote, richBlocksByLanguage } from "./markdown/RichBlocks";
import { blockFences, noHeader } from "./markdown/blockFences";
import { FileTree, type FileLinks } from "./FileTree";

function CodeHeader({ language, code }: CodeHeaderProps) {
  return <div className="code-header">
    <span title={language || "text"}>{language || "text"}</span>
    <CopyButton label="Copy code" getText={() => code} />
  </div>;
}

function SyntaxHighlighter({ code, language }: SyntaxHighlighterProps) {
  const streaming = useAuiState((s) => s.part.status.type === "running");
  // Only highlight completed fences. The library escapes all source text.
  const highlighted = streaming ? undefined : highlightCode(code, language);
  return <pre className="code-body" tabIndex={0} aria-label={`${language || "Text"} code`}>
    {highlighted === undefined ? <code>{code}</code> : <code dangerouslySetInnerHTML={{ __html: highlighted }} />}
  </pre>;
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
  // Resolve before hardening; only the final plugin can mark a callout.
  const rehypePlugins = useMemo(() => [...fragmentRehypePlugins(origin), rehypeCallouts], [origin]);
  const byLanguage = useMemo(() => fileLinks ? { ...componentsByLanguage,
    files: { SyntaxHighlighter: ({ code }: SyntaxHighlighterProps) => <FileTree code={code} links={fileLinks} />, CodeHeader: noHeader } }
    : componentsByLanguage, [fileLinks]);
  return <StreamdownTextPrimitive key={origin} containerClassName="markdown" className="markdown-content" components={components} controls={false}
    componentsByLanguage={byLanguage} rehypePlugins={rehypePlugins}
    remend={remend} linkSafety={linkSafety} skipHtml smooth={false} defer />;
});
