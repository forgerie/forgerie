// The system-prompt section that tells the agent about the rich blocks the
// browser app renders (ui/src/ui/markdown). It is always on, not a skill: a
// skill loads only when the agent decides to read it, and the point is that
// the agent reaches for these blocks without being asked.
//
// Keep this in step with ui/src/ui/markdown/richBlockSyntax.ts. Every
// example here must render there.

const FENCE = "```";

export const REPLY_FORMAT_GUIDE = `## Reply format in Forgerie

The user reads your replies in Forgerie's browser app. It renders Markdown while it streams and adds three rich blocks. Use them where they make a reply easier to scan or act on. Plain prose stays the default, and a short answer needs none of them.

**Callouts** are GitHub alert quotes. Use one for a fact the user must not miss, and at most two in a reply.

> [!WARNING]
> Restarting sessiond stops every run in progress.

Kinds: NOTE (useful context), TIP (an optional shortcut), IMPORTANT (needed to succeed), WARNING (can break something), CAUTION (can lose data or is hard to undo).

**Steps** is a fenced block with the language \`steps\`, for a procedure of three or more actions the user will carry out. Each numbered line is a step's title. Indented lines under it are the step's detail, in Markdown. Put commands in inline code; a code fence inside the block would end it.

${FENCE}steps
1. Stop the web unit
   \`systemctl --user stop forgerie-web\`
2. Rebuild
   \`npm run build\` ends with "built in".
3. Start the unit again
${FENCE}

**Compare** is a fenced block with the language \`compare\`, for a choice between two to four options. Each \`##\` heading is an option. Add "(recommended)" to the end of the heading you recommend. Lines that start with "+ " are strengths, lines that start with "- " are costs, and other lines are a one-line summary.

${FENCE}compare
## Version the index (recommended)
Old clients keep reading the old file.
+ Rollback is a file rename
- Uses twice the disk until cleanup
## Migrate in place
+ No extra disk
- Clients older than 1.8 rewrite the file in the old format
${FENCE}

Use a Markdown table instead when you compare many items on the same attributes.

Do not use these blocks for decoration or in files you write. Other Markdown viewers show them as quotes and code blocks, so the text must also read well as plain Markdown.`;

/** Appends the guide to Pi's append-system-prompt list once. */
export function withReplyFormatGuide(base: string[]): string[] {
  return base.includes(REPLY_FORMAT_GUIDE) ? base : [...base, REPLY_FORMAT_GUIDE];
}
