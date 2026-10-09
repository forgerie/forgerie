import "./Glyph.css";

/**
 * System atom: a one-colour mark drawn from an SVG path on a 24-unit grid, at
 * the size of the text beside it and in its colour. With a label it names
 * itself to assistive technology and on hover; without one it is decoration.
 */
export function Glyph({ path, label }: { path: string; label?: string | undefined }) {
  return <svg className="glyph" viewBox="0 0 24 24" fill="currentColor" role={label ? "img" : undefined}
    aria-label={label} aria-hidden={label ? undefined : true}>
    {label ? <title>{label}</title> : null}
    <path d={path} />
  </svg>;
}
