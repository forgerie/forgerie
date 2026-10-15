import { useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import { SessionFrameLeading } from "../SessionFrame";
import "./settings.css";

/** The room a page has: its header's width, its reading column's width, and its scroll region's height, in CSS pixels. */
export interface FrameRoom { header: number; column: number; body: number }

/**
 * System template: a settings page in the thread's place. The same header as a
 * session, so opening settings changes what the column holds, not the app.
 * A notice is pending state, such as a needed restart. It stays under the
 * header, where scrolling cannot take it away. A page whose layout depends on
 * its room passes `onRoom`, which hears each change of it. A `wide` page, such
 * as a document with a side panel, gets a wider column than the reading one.
 * `mark` puts a dot after the title, such as for changes not saved yet; its
 * words are the dot's accessible name.
 */
export function SettingsFrame({ back, title, mark, status, actions, error, recovery, notice, onRoom, density = "roomy", wide = false, children }: {
  back?: ReactNode; title: string; status?: string | undefined; actions?: ReactNode;
  mark?: string | undefined;
  wide?: boolean | undefined;
  error?: string | undefined; recovery?: ReactNode; notice?: ReactNode;
  onRoom?: ((room: FrameRoom) => void) | undefined;
  /** `compact`: the page's plan found the scroll region short, so the space above the column shrinks. */
  density?: "roomy" | "compact" | undefined;
  children: ReactNode;
}) {
  const leading = useContext(SessionFrameLeading);
  const header = useRef<HTMLElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const report = useRef(onRoom);
  report.current = onRoom;
  const measuring = onRoom !== undefined;
  useLayoutEffect(() => {
    const parts = [header.current, scroll.current, column.current];
    if (!measuring || parts.some((part) => !part)) return;
    const measure = () => {
      const [top, body, reading] = parts;
      // An element that is not laid out (a hidden pane) reports nothing, so the last plan stays.
      if (!top || !body || !reading || reading.clientWidth === 0) return;
      report.current?.({ header: top.clientWidth, column: reading.clientWidth, body: body.clientHeight });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    for (const part of parts) if (part) observer.observe(part);
    return () => observer.disconnect();
  }, [measuring]);
  return <main className="session-shell settings-shell" data-density={density === "compact" ? density : undefined} data-width={wide ? "wide" : undefined}>
    <header className="session-header" ref={header}>
      {leading}
      {back}
      <div className="session-heading"><h1 className="session-title" title={title}>{title}</h1>
        {mark ? <span className="settings-title-mark" role="img" aria-label={mark} title={mark} /> : null}</div>
      {status ? <span className="connection-status" role="status">{status}</span> : null}
      {actions}
    </header>
    {error ? <div className="notice" role="alert"><p>{error}</p>{recovery}</div> : null}
    {notice ? <div className="notice" data-tone="pending" role="status">{notice}</div> : null}
    <div className="settings-scroll" ref={scroll}><div className="settings-column" ref={column}>{children}</div></div>
  </main>;
}
