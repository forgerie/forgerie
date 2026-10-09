import { memo, useMemo } from "react";
import { Streamdown } from "streamdown";
import { fragmentRehypePlugins, markdownElements } from "./markdown/markdownPolicy";
import "./MarkdownFragment.css";

const linkSafety = { enabled: false };

/**
 * System atom: a short piece of Markdown inside a larger block, such as one
 * checklist item. It uses the same link and image policy as a full reply and
 * adds no outer margin. It never repairs unfinished syntax: a fragment is
 * small, so a half-written token shows as typed until its closing mark lands.
 */
export const MarkdownFragment = memo(function MarkdownFragment({ text, inline = false }: { text: string; inline?: boolean }) {
  const rehypePlugins = useMemo(() => fragmentRehypePlugins(window.location.href), []);
  if (text === "") return null;
  return <Streamdown className={inline ? "markdown-fragment markdown-fragment-inline" : "markdown-fragment"} mode="static"
    parseIncompleteMarkdown={false} controls={false} skipHtml linkSafety={linkSafety} components={markdownElements}
    rehypePlugins={rehypePlugins}>{text}</Streamdown>;
});
