import { CodeSheetHead } from "./CodeSheetHead";

export const name = "Code sheet head";
export const note = "Names a code sheet's language and copies its code";

export default function Language() {
  return <CodeSheetHead language="typescript" getText={() => "export const answer = 42;"} />;
}
export function NoLanguage() {
  return <CodeSheetHead language="" getText={() => "plain text"} />;
}
export function LongLanguage() {
  return <CodeSheetHead language="a-very-long-language-name-that-the-header-cuts-short-with-an-ellipsis" getText={() => "x"} />;
}
