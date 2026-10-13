import { isValidElement, memo, useMemo, type ReactNode } from "react";
import { defaultRehypePlugins, Streamdown, type StreamdownProps } from "streamdown";
import { ExternalLinkIcon } from "lucide-react";
import type { PluginReadme } from "@shared/pluginsContract";
import { readmeBody, readmeUrl, rehypeReadmeReferences } from "../../plugins/readmeModel";
import { ALLOWED_PROTOCOLS, withoutNode } from "../markdown/markdownPolicy";
import { CopyButton } from "../CopyButton";
import { highlightCode } from "../highlightCode";
import "./plugins.css";

export type ReadmeLoad = { type: "loading" } | { type: "ready"; value: PluginReadme } | { type: "failed"; message: string };
type Components = NonNullable<StreamdownProps["components"]>;

/** The text inside a code element, however Streamdown nests it. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** A fenced block, drawn like code in a reply: a labelled header with Copy, then the highlighted body. */
function CodeSheet({ children }: { children?: ReactNode }) {
  const code = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children : undefined;
  const language = /language-([\w+#.-]+)/u.exec(code?.props.className ?? "")?.[1] ?? "";
  const text = textOf(code?.props.children ?? children).replace(/\n$/u, "");
  const highlighted = highlightCode(text, language);
  return <div className="plugin-readme-code">
    <div className="code-header"><span title={language || "text"}>{language || "text"}</span><CopyButton label="Copy code" getText={() => text} /></div>
    <pre className="code-body" tabIndex={0} aria-label={`${language || "Text"} code`}>
      {highlighted === undefined ? <code>{text}</code> : <code dangerouslySetInnerHTML={{ __html: highlighted }} />}
    </pre>
  </div>;
}

const elements: Components = {
  strong: "strong",
  // A reference that could not resolve has no href; it reads as text.
  a: (props) => {
    const { href, children, ...rest } = withoutNode(props);
    return href ? <a {...rest} href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
  },
  // The package author chose these images, as on its npm page. Only https loads, and no page address is sent with it.
  img: (props) => {
    const { src, alt } = withoutNode(props);
    return typeof src === "string" && src.startsWith("https://")
      ? <img src={src} alt={alt ?? ""} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
      : alt ? <span className="plugin-readme-alt">{alt}</span> : null;
  },
  pre: (props) => <CodeSheet>{withoutNode(props).children}</CodeSheet>,
  table: (props) => <div className="table-scroll" tabIndex={0} role="region" aria-label="Table"><table {...withoutNode(props)} /></div>,
};

const raw = defaultRehypePlugins["raw"]!;
const sanitize = defaultRehypePlugins["sanitize"]!;
const hardenEntry = defaultRehypePlugins["harden"]!;
const harden = Array.isArray(hardenEntry) ? hardenEntry[0] : hardenEntry;
const linkSafety = { enabled: false };

/**
 * Shape: a Pi package's README, as its author wrote it. HTML in the file is
 * sanitized the way GitHub does; relative links open on GitHub when the
 * package names its repository, and read as text when it does not.
 */
export const PluginReadmeSection = memo(function PluginReadmeSection({ load, name, packageName }: {
  load: ReadmeLoad;
  /** The name the page shows, and the package's full name. A README that opens with either as its title skips that line. */
  name: string; packageName: string;
}) {
  const readme = load.type === "ready" ? load.value : undefined;
  const repository = readme?.repository;
  const rehypePlugins = useMemo(() => [raw, sanitize, [rehypeReadmeReferences, { repository }], [harden, {
    allowedImagePrefixes: ["*"], allowedLinkPrefixes: ["*"], allowedProtocols: ALLOWED_PROTOCOLS, allowDataImages: false,
    linkBlockPolicy: "text-only", imageBlockPolicy: "remove",
  }]] as NonNullable<StreamdownProps["rehypePlugins"]>, [repository]);
  const body = useMemo(() => readme?.text ? readmeBody(readme.text, [name, packageName]) : "", [readme, name, packageName]);
  if (load.type === "loading" || (readme && !body.trim())) return null;
  const url = readme ? readmeUrl(readme) : undefined;
  return <section className="plugin-readme" aria-labelledby="plugin-readme-title">
    <header className="plugin-readme-head">
      <h2 id="plugin-readme-title" className="agent-section">Readme</h2>
      {url ? <a className="plugin-readme-source" href={url} target="_blank" rel="noopener noreferrer">{readme?.file}<ExternalLinkIcon aria-hidden size={12} /></a>
        : readme?.file ? <span className="plugin-readme-source">{readme.file}</span> : null}
    </header>
    {load.type === "failed" ? <p className="settings-hint" role="alert">Forgerie could not read the README: {load.message}</p>
      : <div className="markdown plugin-readme-body">
        <Streamdown className="markdown-content" mode="static" parseIncompleteMarkdown={false} controls={false} linkSafety={linkSafety}
          components={elements} rehypePlugins={rehypePlugins}>{body}</Streamdown>
      </div>}
    {readme?.truncated ? <p className="settings-hint plugin-readme-more">The README is longer than Forgerie shows. {url
      ? <a href={url} target="_blank" rel="noopener noreferrer">Read all of it on GitHub</a> : <>Read the rest in the package folder.</>}</p> : null}
  </section>;
});
