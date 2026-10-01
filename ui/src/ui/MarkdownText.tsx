// Adapted from assistant-ui's homepage MarkdownText. See THIRD_PARTY_NOTICES.md.
import { StreamdownTextPrimitive,
  type CodeHeaderProps, type SyntaxHighlighterProps, type StreamdownTextComponents } from "@assistant-ui/react-streamdown";
import { useAuiState } from "@assistant-ui/react";
import { memo, useMemo } from "react";
import { CopyButton } from "./CopyButton";
import { highlightCode } from "./highlightCode";

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

const components: StreamdownTextComponents = {
  // Streamdown's default strong is a Tailwind-styled span. Keep semantic HTML.
  strong: "strong",
  // Keep text-only scope and do not load third-party images from a reply.
  img: ({ src, alt }) => <a href={typeof src === "string" ? src : undefined}>{alt || "Image"}</a>,
  table: ({ children, ...props }) => <div className="table-scroll" tabIndex={0} role="region" aria-label="Table">
    <table {...props}>{children}</table>
  </div>,
};
// Assign through the declared compatibility properties. The SDK's HTML index
// signature otherwise rejects its own narrower CodeHeader/SyntaxHighlighter types.
components.CodeHeader = CodeHeader;
components.SyntaxHighlighter = SyntaxHighlighter;
// Streamdown supplies GFM and unfinished-token repair. Keep our controls and
// CSS instead of its Tailwind controls, caret, or optional rendering plugins.
const remend = { linkMode: "text-only" as const };
const linkSafety = { enabled: false };

export const MarkdownText = memo(function MarkdownText() {
  // Bare workspace paths need a base URL or rehype-harden labels them blocked.
  const security = useMemo(() => ({ defaultOrigin: window.location.href,
    allowedProtocols: ["http:", "https:", "mailto:"], allowDataImages: false }), []);
  return <StreamdownTextPrimitive containerClassName="markdown" className="markdown-content" components={components} controls={false}
    remend={remend} security={security} linkSafety={linkSafety} skipHtml smooth={false} defer />;
});
