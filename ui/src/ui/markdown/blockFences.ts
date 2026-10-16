// Fenced-block languages that render as components instead of code. Each
// component takes the fence's source as `code`, so it is its own syntax
// highlighter. The language names are part of the reply format guide
// (src/shared/replyFormatGuide.ts); keep the two in step.
import type { ComponentsByLanguage } from "@assistant-ui/react-streamdown";
import { AsideList } from "../AsideList";
import { BarChart } from "../BarChart";
import { CheckResults } from "../CheckResults";
import { Checklist } from "../Checklist";
import { ClaimList } from "../ClaimList";
import { CommandList } from "../CommandList";
import { CorrectionPanel } from "../CorrectionPanel";
import { DeltaTable } from "../DeltaTable";
import { Diagram } from "../Diagram";
import { Disclosure } from "../Disclosure";
import { FactList } from "../FactList";
import { FileTree } from "../FileTree";
import { FindingList } from "../FindingList";
import { Ledger } from "../Ledger";
import { RecapPanel } from "../RecapPanel";
import { RevisionList } from "../RevisionList";
import { Timeline } from "../Timeline";
import { VerdictLine } from "../VerdictLine";

// The generic code header (language name and copy) does not belong on a block that is not code.
export const noHeader = () => null;

export const blockFences: ComponentsByLanguage = {
  status: { SyntaxHighlighter: Checklist, CodeHeader: noHeader },
  files: { SyntaxHighlighter: FileTree, CodeHeader: noHeader },
  facts: { SyntaxHighlighter: FactList, CodeHeader: noHeader },
  diagram: { SyntaxHighlighter: Diagram, CodeHeader: noHeader },
  claims: { SyntaxHighlighter: ClaimList, CodeHeader: noHeader },
  details: { SyntaxHighlighter: Disclosure, CodeHeader: noHeader },
  commands: { SyntaxHighlighter: CommandList, CodeHeader: noHeader },
  bars: { SyntaxHighlighter: BarChart, CodeHeader: noHeader },
  correction: { SyntaxHighlighter: CorrectionPanel, CodeHeader: noHeader },
  asides: { SyntaxHighlighter: AsideList, CodeHeader: noHeader },
  timeline: { SyntaxHighlighter: Timeline, CodeHeader: noHeader },
  checks: { SyntaxHighlighter: CheckResults, CodeHeader: noHeader },
  findings: { SyntaxHighlighter: FindingList, CodeHeader: noHeader },
  recap: { SyntaxHighlighter: RecapPanel, CodeHeader: noHeader },
  verdict: { SyntaxHighlighter: VerdictLine, CodeHeader: noHeader },
  commits: { SyntaxHighlighter: RevisionList, CodeHeader: noHeader },
  delta: { SyntaxHighlighter: DeltaTable, CodeHeader: noHeader },
  ledger: { SyntaxHighlighter: Ledger, CodeHeader: noHeader },
  // Agents also write the language Mermaid itself names.
  mermaid: { SyntaxHighlighter: Diagram, CodeHeader: noHeader },
};
