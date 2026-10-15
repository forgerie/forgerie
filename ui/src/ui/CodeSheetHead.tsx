import { CopyButton } from "./CopyButton";

/**
 * System molecule: the header of a code sheet. It names the language, or "text" when there is none, and copies the
 * sheet's code. `CodeSheetBody` draws the code under it.
 */
export function CodeSheetHead({ language, getText, copyLabel = "Copy code" }: {
  language: string;
  /** The code the Copy button copies, read on press. */
  getText: () => string;
  copyLabel?: string;
}) {
  const name = language || "text";
  return <div className="code-header">
    <span title={name}>{name}</span>
    <CopyButton label={copyLabel} getText={getText} />
  </div>;
}
