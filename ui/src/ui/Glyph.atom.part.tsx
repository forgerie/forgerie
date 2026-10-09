import { Glyph } from "./Glyph";

export const name = "Glyph";
export const note = "A one-colour mark from an SVG path, at the size and colour of its text";

export default function Labelled() {
  return <p>A mark <Glyph label="Triangle" path="M12 2 22 22H2Z" /> beside text</p>;
}
export function Large() {
  return <h2>Heading <Glyph label="Square" path="M2 2h20v20H2Z" /></h2>;
}
