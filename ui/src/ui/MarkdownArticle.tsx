import { isValidElement, memo, useId, useMemo, type ReactNode } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { defaultRehypePlugins, Streamdown, type StreamdownProps } from "streamdown";
import { ALLOWED_PROTOCOLS, markdownElements, withoutNode } from "./markdown/markdownPolicy";
import { MarkdownSurface } from "./MarkdownSurface";
import { CodeSheetHead } from "./CodeSheetHead";
import { CodeSheetBody } from "./CodeSheetBody";
import "./MarkdownArticle.css";

type Components = NonNullable<StreamdownProps["components"]>;
type Pluggable = NonNullable<StreamdownProps["rehypePlugins"]>[number];

/** The text inside a code element, however Streamdown nests it. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

const elements: Components = {
  strong: "strong",
  // A reference that could not resolve has no href; it reads as text.
  a: (props) => {
    const { href, children, ...rest } = withoutNode(props);
    return href ? <a {...rest} href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
  },
  // The author chose these images. Only https loads, and no page address is sent with it.
  img: (props) => {
    const { src, alt } = withoutNode(props);
    return typeof src === "string" && src.startsWith("https://")
      ? <img src={src} alt={alt ?? ""} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
      : alt ? <span className="markdown-article-alt">{alt}</span> : null;
  },
  // A fenced block, drawn like code in a reply: a labelled header with Copy, then the highlighted body.
  pre: (props) => {
    const children = withoutNode(props).children;
    const code = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children : undefined;
    const language = /language-([\w+#.-]+)/u.exec(code?.props.className ?? "")?.[1] ?? "";
    const text = textOf(code?.props.children ?? children).replace(/\n$/u, "");
    return <div className="markdown-article-code">
      <CodeSheetHead language={language} getText={() => text} />
      <CodeSheetBody code={text} language={language} />
    </div>;
  },
  // A wide table scrolls inside its own region, as in a reply.
  table: markdownElements.table,
};

const raw = defaultRehypePlugins["raw"]!;
const sanitize = defaultRehypePlugins["sanitize"]!;
const hardenEntry = defaultRehypePlugins["harden"]!;
const harden = Array.isArray(hardenEntry) ? hardenEntry[0] : hardenEntry;
const linkSafety = { enabled: false };

/**
 * System molecule: a whole Markdown document that someone else wrote, such as a package's README, under a titled
 * head with an optional source link. It reads like a reply: the same type, tables, and code sheets. HTML in the text
 * is sanitized the way GitHub does; links open in a new tab, and only https images load. `references` resolves
 * relative links and images before they are hardened; a reference it removes reads as plain text.
 */
export const MarkdownArticle = memo(function MarkdownArticle({ title, source, text, problem, note, references }: {
  title: string;
  /** Where the text comes from: a file name, and its page when it has one. */
  source?: { label: string; href?: string | undefined } | undefined;
  text: string;
  /** Shown in place of the text when it could not be read. */
  problem?: string | undefined;
  /** A closing line under the text, such as a note that it was cut short. */
  note?: ReactNode;
  references?: Pluggable | undefined;
}) {
  const titleId = useId();
  const rehypePlugins = useMemo(() => [raw, sanitize, ...(references ? [references] : []), [harden, {
    allowedImagePrefixes: ["*"], allowedLinkPrefixes: ["*"], allowedProtocols: ALLOWED_PROTOCOLS, allowDataImages: false,
    linkBlockPolicy: "text-only", imageBlockPolicy: "remove",
  }]] as NonNullable<StreamdownProps["rehypePlugins"]>, [references]);
  return <section className="markdown-article" aria-labelledby={titleId}>
    <header className="markdown-article-head">
      <h2 id={titleId} className="markdown-article-title">{title}</h2>
      {source?.href ? <a className="markdown-article-source" href={source.href} target="_blank" rel="noopener noreferrer">{source.label}<ExternalLinkIcon aria-hidden size={12} /></a>
        : source ? <span className="markdown-article-source">{source.label}</span> : null}
    </header>
    {problem !== undefined ? <p className="markdown-article-note" role="alert">{problem}</p>
      : <MarkdownSurface className="markdown-article-body">
        <Streamdown className="markdown-article-text" mode="static" parseIncompleteMarkdown={false} controls={false} linkSafety={linkSafety}
          components={elements} rehypePlugins={rehypePlugins}>{text}</Streamdown>
      </MarkdownSurface>}
    {note ? <p className="markdown-article-note markdown-article-end">{note}</p> : null}
  </section>;
});
