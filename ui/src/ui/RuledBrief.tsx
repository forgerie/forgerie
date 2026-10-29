import { MarkdownFragment } from "./MarkdownFragment";
import "./RuledBrief.css";

/**
 * System molecule: a few sentences set apart from the reply text. It is not
 * a box: the decision card's start rule marks it. The rule and title stay
 * quiet at rest; an urgent line turns them live and follows the text.
 */
export function RuledBrief({ title, text, urgent }: { title: string; text: string; urgent?: { label: string; text: string } | undefined }) {
  const live = urgent !== undefined && urgent.text !== "";
  if (text === "" && !live) return null;
  return <section className="ruled-brief" aria-label={title} data-live={live ? "" : undefined}>
    <div className="ruled-brief-title">{title}</div>
    {text !== "" && <div className="ruled-brief-text"><MarkdownFragment inline text={text} /></div>}
    {live && <div className="ruled-brief-urgent" role="note">
      <span className="ruled-brief-urgent-label">{urgent.label}</span>
      <span className="ruled-brief-urgent-text"><MarkdownFragment inline text={urgent.text} /></span>
    </div>}
  </section>;
}
