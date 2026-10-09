import { parseBars } from "./markdown/richBlockSyntax";
import "./BarChart.css";

/**
 * System molecule: a few numbers of one kind on one scale, as horizontal
 * bars from zero. Each row states its value as text, so the bar is never the
 * only way to read it. Negative values draw no bar.
 */
export function BarChart({ code }: { code: string }) {
  const { title, bars } = parseBars(code);
  if (bars.length === 0) return null;
  const max = Math.max(0, ...bars.map((bar) => bar.value));
  return <figure className="bar-chart">
    {title !== "" && <figcaption className="bar-chart-title">{title}</figcaption>}
    <ul className="bar-chart-rows" role="list">
      {bars.map((bar, index) => {
        const share = max > 0 && bar.value > 0 ? bar.value / max : 0;
        return <li key={index} className="bar-chart-row">
          <span className="bar-chart-label">{bar.label}</span>
          <span className="bar-chart-track" aria-hidden="true">
            <span className="bar-chart-bar" data-empty={share === 0 || undefined} style={{ "--bar-share": `${share * 100}%` }} />
          </span>
          <span className="bar-chart-value">{bar.display}</span>
        </li>;
      })}
    </ul>
  </figure>;
}
