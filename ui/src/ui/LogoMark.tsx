import "./LogoMark.css";

/** The mark's 3 × 3 grid: `#` takes the text colour, `r` the bad tone, `b` the live tone. */
const PATTERN = ["b##", "r##", ".#b"] as const;
const TONE = { "#": "ink", r: "bad", b: "live" } as const;

/**
 * System atom: the app's logo mark, eight tally marks on a 3 × 3 grid, drawn
 * 1em square. It uses the 16 px icon geometry (4 px marks, 1 px gaps), so its
 * edges land on whole pixels at 16 px. The plain marks take the text colour.
 * Without a label it is decoration and hidden from assistive technology.
 * scripts/generate-icons.mjs draws the same pattern for the app icons.
 */
export function LogoMark({ label }: { label?: string | undefined }) {
  return <svg className="logo-mark" viewBox="0 0 16 16" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    {PATTERN.flatMap((row, y) => [...row].map((cell, x) => {
      const tone = TONE[cell as keyof typeof TONE] as string | undefined;
      return tone ? <rect key={`${x}-${y}`} data-tone={tone} x={1 + x * 5} y={1 + y * 5} width={4} height={4} rx={1} /> : null;
    }))}
  </svg>;
}
