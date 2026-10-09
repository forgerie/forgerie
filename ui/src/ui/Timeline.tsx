import { MarkdownFragment } from "./MarkdownFragment";
import { parseTimeline } from "./markdown/richBlockSyntax";
import "./Timeline.css";

/**
 * System molecule: events in order, each with its time. Times share one
 * column sized to the longest, up to a share of the width, so short clock
 * times and full dates both line up. A rail joins the events.
 */
export function Timeline({ code }: { code: string }) {
  const { title, events } = parseTimeline(code);
  if (events.length === 0) return null;
  return <figure className="timeline">
    {title !== "" && <figcaption className="timeline-title">{title}</figcaption>}
    <ol className="timeline-events" role="list">
      {events.map((event, index) => <li key={index} className="timeline-event">
        <span className="timeline-when">{event.when}</span>
        <div className="timeline-what">
          <MarkdownFragment inline text={event.text} />
          {event.detail !== "" && <div className="timeline-detail"><MarkdownFragment text={event.detail} /></div>}
        </div>
      </li>)}
    </ol>
  </figure>;
}
