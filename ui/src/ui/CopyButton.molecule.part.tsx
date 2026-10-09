import { CopyButton } from "./CopyButton";

export const name = "Copy button";
export const note = "Copies text and reports the result in a live region";

export default function Ready() {
  return <CopyButton label="Copy reply" getText={() => "The reply text."} />;
}
