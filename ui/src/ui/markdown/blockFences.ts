// Fenced-block languages that render as components instead of code. Each
// component takes the fence's source as `code`, so it is its own syntax
// highlighter. The language names are part of the reply format guide
// (src/shared/replyFormatGuide.ts); keep the two in step.
import type { ComponentsByLanguage } from "@assistant-ui/react-streamdown";
import { Checklist } from "../Checklist";
import { Diagram } from "../Diagram";
import { FactList } from "../FactList";
import { FileTree } from "../FileTree";

// The generic code header (language name and copy) does not belong on a block that is not code.
const noHeader = () => null;

export const blockFences: ComponentsByLanguage = {
  status: { SyntaxHighlighter: Checklist, CodeHeader: noHeader },
  files: { SyntaxHighlighter: FileTree, CodeHeader: noHeader },
  facts: { SyntaxHighlighter: FactList, CodeHeader: noHeader },
  diagram: { SyntaxHighlighter: Diagram, CodeHeader: noHeader },
  // Agents also write the language Mermaid itself names.
  mermaid: { SyntaxHighlighter: Diagram, CodeHeader: noHeader },
};
