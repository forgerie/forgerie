import "./TagList.css";

/**
 * Atom: a few short words that classify something, as quiet pills on one
 * wrapping row. They are readouts, not controls: nothing here can be pressed.
 * An empty list draws nothing.
 */
export function TagList({ tags, label }: {
  tags: readonly string[];
  /** The list's accessible name, such as what the tags are. */
  label: string;
}) {
  if (tags.length === 0) return null;
  return <ul className="tag-list" aria-label={label}>
    {tags.map((tag, index) => <li className="tag-list-item" key={`${String(index)}:${tag}`}>{tag}</li>)}
  </ul>;
}
