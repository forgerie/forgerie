import { LogoMark } from "./LogoMark";

export const name = "Logo mark";
export const note = "The app's mark, 1em square, in the text colour with its two tones";

export default function Named() {
  return <LogoMark label="Logo" />;
}
export function BesideText() {
  return <p><LogoMark /> Name beside the mark</p>;
}
