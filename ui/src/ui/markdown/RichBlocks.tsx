// Rich blocks: the structured pieces an agent writes in plain Markdown that
// render as more than text. Callouts come from GitHub alert quotes; steps and
// compare come from fenced blocks. Each degrades to readable Markdown wherever
// this renderer is absent, such as terminal Pi.
import { useAuiState } from "@assistant-ui/react";
import type { ComponentsByLanguage, SyntaxHighlighterProps } from "@assistant-ui/react-streamdown";
import { CheckIcon, InfoIcon, LightbulbIcon, MessageSquareWarningIcon, OctagonAlertIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";
import { memo, useMemo, type ComponentProps } from "react";
import { Streamdown } from "streamdown";
import { QuoteFigure } from "../QuoteFigure";
import { fragmentRehypePlugins, markdownElements, withoutNode } from "./markdownPolicy";
import { calloutKind, parseComparison, parseSteps, type CalloutKind } from "./richBlockSyntax";
import "./richBlocks.css";

const CALLOUTS: Record<CalloutKind, { label: string; Icon: LucideIcon }> = {
  note: { label: "Note", Icon: InfoIcon },
  tip: { label: "Tip", Icon: LightbulbIcon },
  important: { label: "Important", Icon: MessageSquareWarningIcon },
  warning: { label: "Warning", Icon: TriangleAlertIcon },
  caution: { label: "Caution", Icon: OctagonAlertIcon },
};

type QuoteProps = ComponentProps<"blockquote"> & { node?: unknown };

/** Replaces `blockquote`. A quote that `rehypeCallouts` marked becomes a callout. */
export function CalloutQuote(props: QuoteProps) {
  const { children, ...rest } = withoutNode(props);
  const marked = (rest as Record<string, unknown>)["data-callout"];
  const source = (rest as Record<string, unknown>)["data-source"];
  if (typeof source === "string") return <QuoteFigure source={source}>{children}</QuoteFigure>;
  if (typeof marked !== "string") return <blockquote {...rest}>{children}</blockquote>;
  const kind = calloutKind(marked);
  // "pending": the marker is still arriving. Draw a quiet callout without a
  // label so the box does not change kind under the reader.
  if (kind === undefined) return <div className="callout" data-callout="pending" role="note">{children}</div>;
  const { label, Icon } = CALLOUTS[kind];
  return <div className="callout" data-callout={kind} role="note">
    <p className="callout-label"><Icon aria-hidden="true" />{label}</p>
    {children}
  </div>;
}

const useStreaming = () => useAuiState((s) => s.part.status.type === "running");

/** Markdown inside a rich block, under the same link and image policy as the stream. */
const Fragment = memo(function Fragment({ text, streaming, className }: { text: string; streaming: boolean; className: string }) {
  const rehypePlugins = useMemo(() => fragmentRehypePlugins(window.location.href), []);
  if (text === "") return null;
  // Repair unfinished tokens only while the reply streams, like the stream.
  return <Streamdown className={`md-fragment ${className}`} mode="static" parseIncompleteMarkdown={streaming} remend={remend}
    controls={false} skipHtml linkSafety={linkSafety} components={markdownElements} rehypePlugins={rehypePlugins}>{text}</Streamdown>;
});
const remend = { linkMode: "text-only" as const };
const linkSafety = { enabled: false };

function StepsBlock({ code }: SyntaxHighlighterProps) {
  const streaming = useStreaming();
  const steps = parseSteps(code);
  if (steps.length === 0) return null;
  return <ol className="rich-steps" role="list">
    {steps.map((step, index) => <li key={index} className="rich-step">
      <Fragment className="rich-step-title" text={step.title} streaming={streaming} />
      <Fragment className="rich-step-detail" text={step.detail} streaming={streaming} />
    </li>)}
  </ol>;
}

function CompareBlock({ code }: SyntaxHighlighterProps) {
  const streaming = useStreaming();
  const { caption, options } = parseComparison(code);
  if (caption === "" && options.length === 0) return null;
  return <section className="rich-compare" aria-label={caption === "" ? "Comparison" : undefined}>
    <Fragment className="rich-compare-caption" text={caption} streaming={streaming} />
    {options.length > 0 && <div className="rich-compare-options" style={{ "--options": options.length }}>
      {options.map((option, index) => <article key={index} className="rich-option" data-recommended={option.recommended || undefined}>
        <header className="rich-option-header">
          <div className="rich-option-title" role="heading" aria-level={4}>
            <Fragment className="rich-option-name" text={option.title} streaming={streaming} />
          </div>
          {option.recommended && <span className="rich-option-pick"><CheckIcon aria-hidden="true" />Recommended</span>}
        </header>
        <Fragment className="rich-option-summary" text={option.summary} streaming={streaming} />
        {(option.pros.length > 0 || option.cons.length > 0) && <ul className="rich-option-points" role="list">
          {option.pros.map((point, at) => <li key={`pro-${at}`} data-point="pro">
            <span className="sr-only">Strength: </span><Fragment className="rich-point" text={point} streaming={streaming} />
          </li>)}
          {option.cons.map((point, at) => <li key={`con-${at}`} data-point="con">
            <span className="sr-only">Cost: </span><Fragment className="rich-point" text={point} streaming={streaming} />
          </li>)}
        </ul>}
      </article>)}
    </div>}
  </section>;
}

// The generic code header (language name and copy) does not belong on a block
// that is not code.
const NoHeader = () => null;

export const richBlocksByLanguage: ComponentsByLanguage = {
  steps: { SyntaxHighlighter: StepsBlock, CodeHeader: NoHeader },
  compare: { SyntaxHighlighter: CompareBlock, CodeHeader: NoHeader },
};
