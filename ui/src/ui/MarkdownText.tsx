// Adapted from assistant-ui's homepage MarkdownText. See THIRD_PARTY_NOTICES.md.
import { StreamdownTextPrimitive,
  type CodeHeaderProps, type SyntaxHighlighterProps, type StreamdownTextComponents } from "@assistant-ui/react-streamdown";
import { useAuiState } from "@assistant-ui/react";
import { memo, useMemo } from "react";
import { CopyButton } from "./CopyButton";
import { highlightCode } from "./highlightCode";
import { ALLOWED_PROTOCOLS, markdownElements } from "./markdown/markdownPolicy";
import { rehypeCallouts } from "./markdown/rehypeCallouts";
import { CalloutQuote, richBlocksByLanguage } from "./markdown/RichBlocks";
import { blockFences } from "./markdown/blockFences";

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
// Runs after the security plugins, so only this plugin can mark a callout.
const rehypePlugins = [rehypeCallouts];
const componentsByLanguage = { ...richBlocksByLanguage, ...blockFences };

export const MarkdownText = memo(function MarkdownText() {
  // Bare workspace paths need a base URL or rehype-harden labels them blocked.
  const security = useMemo(() => ({ defaultOrigin: window.location.href,
    allowedProtocols: ALLOWED_PROTOCOLS, allowDataImages: false }), []);
  return <StreamdownTextPrimitive containerClassName="markdown" className="markdown-content" components={components} controls={false}
    componentsByLanguage={componentsByLanguage} rehypePlugins={rehypePlugins}
    remend={remend} security={security} linkSafety={linkSafety} skipHtml smooth={false} defer />;
});
