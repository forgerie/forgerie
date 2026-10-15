import { CodeSheetBody } from "./CodeSheetBody";

export const name = "Code sheet body";
export const note = "A code sheet's code: highlighted by language, scrolling sideways instead of wrapping";

const code = "export function greet(name: string): string {\n  return `Hello, ${name}. This line is long enough to scroll sideways on a narrow screen.`;\n}";

export default function Highlighted() {
  return <CodeSheetBody code={code} language="typescript" />;
}
export function Arriving() {
  return <CodeSheetBody code={code} language="typescript" highlight={false} />;
}
export function PlainText() {
  return <CodeSheetBody code={"No language was named, so this stays plain."} language="" />;
}
