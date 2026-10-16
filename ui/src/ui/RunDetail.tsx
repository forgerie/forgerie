import { useId, type ReactNode } from "react";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import { StateMark, type WorkState } from "./StateMark";
import type { RunRowFact } from "./RunRow";
import "./RunDetail.css";

/**
 * Organism: one build opened from its list. A bar with the way back and the
 * way out; the pipeline and build number over the build's title in full;
 * its facts; one toned line that says where it stands; what keeps an eye on
 * it, with its control on the same line; then its parts, and a quiet way to
 * remove it.
 * Words and parts come in through props.
 */
export function RunDetail({ back, external, name, number, title, facts, state, sentence, notice, watch, sectionTitle, sectionCount, children, remove }: {
  back: { label: string; onPress: () => void };
  external?: { label: string; href: string } | undefined;
  name: string;
  /** The build's number with its hash sign, set in the code face. */
  number: string;
  title: string;
  facts: readonly RunRowFact[];
  state: WorkState;
  sentence: string;
  /** Why some of it may be missing or stale: a failed read, a read in flight. */
  notice?: { tone: "bad" | "warn" | "quiet"; content: ReactNode } | undefined;
  watch?: { note: string | undefined; control: ReactNode } | undefined;
  sectionTitle: string;
  sectionCount?: string | undefined;
  children: ReactNode;
  /** A quiet way to take it off the list, with what else that stops. */
  remove?: { label: string; note?: string | undefined; disabled?: boolean | undefined; onPress: () => void } | undefined;
}) {
  const titleId = useId();
  const partsId = useId();
  return <section className="run-detail" aria-labelledby={titleId} data-state={state}>
    <div className="run-detail-bar">
      <button type="button" className="run-detail-back" onClick={back.onPress}><ArrowLeftIcon aria-hidden />{back.label}</button>
      {external ? <a className="run-detail-out" href={external.href} target="_blank" rel="noreferrer">{external.label}<ExternalLinkIcon aria-hidden /></a> : null}
    </div>
    <header className="run-detail-head">
      <p className="run-detail-name"><span className="run-detail-pipeline">{name}</span> <span className="run-detail-number">{number}</span></p>
      <h3 className="run-detail-title" id={titleId}>{title}</h3>
      {facts.length > 0 ? <ul className="run-detail-facts">
        {facts.map((fact) => <li key={fact.label} title={fact.label} data-face={fact.code ? "code" : undefined}>{fact.text}</li>)}
      </ul> : null}
    </header>
    <p className="run-detail-verdict" role="status"><StateMark state={state} size="large" /><span>{sentence}</span></p>
    {notice ? <div className="run-detail-notice" data-tone={notice.tone} role={notice.tone === "quiet" ? "status" : "alert"}>{notice.content}</div> : null}
    {watch ? <div className="run-detail-watch">
      {watch.note ? <p>{watch.note}</p> : null}
      {watch.control}
    </div> : null}
    <section className="run-detail-parts" aria-labelledby={partsId}>
      <div className="run-detail-parts-head">
        <h4 id={partsId}>{sectionTitle}</h4>
        {sectionCount ? <span>{sectionCount}</span> : null}
      </div>
      {children}
    </section>
    {remove ? <p className="run-detail-foot">
      <button type="button" className="run-detail-remove" disabled={remove.disabled} onClick={remove.onPress}>{remove.label}</button>
      {remove.note ? ` ${remove.note}` : null}
    </p> : null}
  </section>;
}
