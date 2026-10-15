import { memo, useMemo, type ComponentProps } from "react";
import type { PluginReadme as Readme } from "@shared/pluginsContract";
import { MarkdownArticle } from "../ui/MarkdownArticle";
import { readmeBody, readmeUrl, rehypeReadmeReferences } from "./readmeModel";

export type ReadmeLoad = { type: "loading" } | { type: "ready"; value: Readme } | { type: "failed"; message: string };

/**
 * Shape: a Pi package's README, as its author wrote it, on the package's settings page. Relative links open on
 * GitHub when the package names its repository, and read as text when it does not. Nothing shows while it loads,
 * or when the package has no README.
 */
export const PluginReadme = memo(function PluginReadme({ load, name, packageName }: {
  load: ReadmeLoad;
  /** The name the page shows, and the package's full name. A README that opens with either as its title skips that line. */
  name: string; packageName: string;
}) {
  const readme = load.type === "ready" ? load.value : undefined;
  const repository = readme?.repository;
  const references = useMemo<ComponentProps<typeof MarkdownArticle>["references"]>(() => [rehypeReadmeReferences, { repository }], [repository]);
  const body = useMemo(() => readme?.text ? readmeBody(readme.text, [name, packageName]) : "", [readme, name, packageName]);
  if (load.type === "loading" || (readme && !body.trim())) return null;
  const url = readme ? readmeUrl(readme) : undefined;
  return <MarkdownArticle title="Readme" text={body} references={references}
    source={readme?.file ? { label: readme.file, href: url } : undefined}
    problem={load.type === "failed" ? `Forgerie could not read the README: ${load.message}` : undefined}
    note={readme?.truncated ? <>The README is longer than Forgerie shows. {url
      ? <a href={url} target="_blank" rel="noopener noreferrer">Read all of it on GitHub</a> : <>Read the rest in the package folder.</>}</> : undefined} />;
});
