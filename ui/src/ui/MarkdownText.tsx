// Adapted from assistant-ui's homepage MarkdownText. See THIRD_PARTY_NOTICES.md.
import "@assistant-ui/react-markdown/styles/dot.css";
import { MarkdownTextPrimitive, unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  type CodeHeaderProps, type SyntaxHighlighterProps } from "@assistant-ui/react-markdown";
import { useAuiState } from "@assistant-ui/react";
import { memo } from "react";
import { CopyButton } from "./CopyButton";
import remarkGfm from "remark-gfm";
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

const components = memoizeMarkdownComponents({
  CodeHeader,
  SyntaxHighlighter,
  // Keep text-only scope and do not load third-party images from a reply.
  img: ({ src, alt }) => <a href={typeof src === "string" ? src : undefined}>{alt || "Image"}</a>,
  table: ({ children, ...props }) => <div className="table-scroll" tabIndex={0} role="region" aria-label="Table">
    <table {...props}>{children}</table>
  </div>,
});
const remarkPlugins = [remarkGfm];

export const MarkdownText = memo(function MarkdownText() {
  return <MarkdownTextPrimitive className="markdown" remarkPlugins={remarkPlugins} components={components} smooth={false} defer />;
});
