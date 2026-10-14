// The system-prompt section that tells the agent about the rich blocks the
// browser app renders (ui/src/ui/markdown and the block components beside
// it). Sessiond appends it to every hosted session's system prompt through
// the resource loader's appendSystemPromptOverride, so it does not depend on
// a skill being read or on any AGENTS.md.
//
// This file is the single source. ui/src/ui/markdown/replyFormatGuide.test.ts
// parses every example below with the browser app's own parsers. Every model
// call carries this text, so replyFormatGuide.test.ts holds it to a budget.

const F = "```";

export const REPLY_FORMAT_GUIDE = `## Reply format in Forgerie

Forgerie's browser renders Markdown and the blocks below. Use blocks to make text easier to scan or act on; otherwise use prose. Outside Forgerie they remain quotes and code, so keep them readable. Never put them in repository files. Inside a block, use inline code, not nested fences.

### Workflow proposals

The prose in \`propose_workflow.text\` is a browser document, not a repository file: use these blocks there too. Use \`status\` for acceptance checklists, \`steps\` for ordered work, callouts for risks, and \`details\` for supporting instructions. Keep the plan useful to both the reader and the agents. The tool describes its structure.

### Reply blocks

Callout, for what the user must not miss (at most two): a quote starting \`> [!NOTE]\`, \`[!TIP]\`, \`[!IMPORTANT]\`, \`[!WARNING]\` (can break something) or \`[!CAUTION]\` (can lose data).
Sourced quote: end a quote with a line \`> — path/to/file.ts:12\` naming where the words come from.

Fenced blocks, by language:

${F}steps
1. Stop the web unit
   Indented lines are this step's detail.
2. Rebuild
3. Start it again
${F}
${F}compare
## Version the index (recommended)
One-line summary.
+ A strength
- A cost
## Migrate in place
+ No extra disk
${F}
${F}status
Release checks
[x] Done
[~] In progress
[!] Failed
    Indented detail.
[ ] Not started
[-] Skipped
${F}
${F}files
src/server/
  ~ app.ts # changed, with a note
  + guide.ts
- old.md
${F}
${F}facts
Tests: 1017 passed
Bundle: +4.2 kB gzip
${F}
${F}claims
verified: you checked it
  Indented evidence.
inferred: fits the evidence, not proven
opinion: your judgement
unknown: you could not tell
${F}
${F}commands
# What the next command does
npm run build
${F}
${F}details
One-line summary that stays visible
Material the reader may skip.
${F}
${F}bars
Title, with the unit
alpha: 28.7 s
beta: 7.2 s
${F}
${F}correction
was: what an earlier reply said
now: what is true
cause: why the mistake happened
${F}
${F}asides
high: something outside the question that matters a lot
medium: worth knowing
low: minor
${F}
${F}timeline
18:22 - first event
21:20 - next event
  Indented detail.
${F}
${F}diagram
flowchart LR
  Browser --> Sessiond --> Model
${F}

Choose: steps for 3+ actions; compare for 2–4 options (tables for more); status for checks; files for changed paths; facts for 3–6 values; claims to label confidence; commands to run; details for supporting text; bars for 3–8 measured values, never invented; correction first when wrong; asides for unasked concerns; timeline for events; diagram (Mermaid) for flows or states.`;

/** Appends the guide to Pi's append-system-prompt list once. */
export function withReplyFormatGuide(base: string[]): string[] {
  return base.includes(REPLY_FORMAT_GUIDE) ? base : [...base, REPLY_FORMAT_GUIDE];
}
