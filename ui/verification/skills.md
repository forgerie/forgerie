# Skill records

The transcript shows two dedicated skill records.

| Record | Source | What the chat shows |
| --- | --- | --- |
| Skill invocation. | A user message that is exactly Pi's expanded block: `<skill name="…" location="…">…</skill>`, then an optional argument. | A `/skill:name` chip on the user's message, like an attachment. The typed argument stays in the bubble. The chip opens to the skill's location and the text Pi inserted. |
| Skill load. | A `read` tool call whose `path` ends in `/SKILL.md`. The parent directory names the skill. | A trace line beside the tool activity: "loaded skill simple-english". Adjacent loads share one line: "loaded 3 skills: simple-english, unslop, bedrock-principles". Each load opens to its path and the text it read. |

Loads report every state. "loading skill" is live. "failed to load skill" uses the error colour and opens to the error. "stopped loading skill" means the run ended first. A group line counts failures and stops, so a collapsed group does not hide them.

Skill loads stay out of the chain-of-thought disclosure. A load tells the reader which instructions the agent follows, so it stays visible. The activity disclosure counts only the other tools. This follows [Tana](https://mobbin.com/screens/46b7ca98-7f7f-4c1a-b089-1668560b688a), which puts a skill chip on the sent message and a "Used skill" line in the reply. A load between two tools splits the activity disclosure in two. In 80 local sessions, 82 of 548 replies with a skill load had that order.

## Contract and limits

The parsing uses Pi's own format from `pi-coding-agent`. Prose that quotes a skill block stays text. Only the whole message counts as an invocation. Assistant text never becomes an invocation. History, the live echo, the persisted live message, and a join replay all produce the same record, including an invocation with no argument. A `./SKILL.md` or `../SKILL.md` read names no skill and stays a tool. A read of any other `SKILL.md`, for example while the agent edits one, shows as a skill load. Calls that created a session keep their own "Open session" line, which takes precedence over both groupings. The transcript keeps a skill load as an ordinary tool call with its call ID. Identity, reconnect recovery, and tool results do not change. Only the presentation classifies it.

The record names the command `/skill:name`, which matches the slash menu. Pi does not record the exact typed text, so a command typed another way still reads as `/skill:name`. Skill text is shown as plain preformatted text, not rendered Markdown. Frontmatter stays readable, and the text uses the same 16,000-character limit as tool output. Prompt recall does not exist in this client, so an invocation cannot be recalled as a command yet. The backend and the Lit client on `main` do not change.

## Verification

Run from this app directory with the dev server running:

```sh
nix shell nixpkgs#nodejs_22 -c npm run verify
./scripts/skills-acceptance.mjs
./scripts/skills-shots.mjs
SESSION_ID=<existing-session-with-skills> ./scripts/real-skills-check.mjs
```

Set `APP_URL` for another port and `SHOT_DIR` for another screenshot directory.

| Check | Evidence |
| --- | --- |
| Automated checks. | Build, TypeScript, lint, and 394 tests passed after rebasing onto the handoff-navigation and draft-protection work. New tests cover the parser, history and live invocations with and without an argument, join replay, echo replacement, a different skill with the same argument, loads beside other tools, groups, failures, stops, and ordinary reads of other files. All of them failed before the change, except the guard that keeps ordinary reads as tools. |
| Independent review. | A read-only review found that a live invocation with no argument was dropped until reload. A regression test failed, and the fix passed it. The review also found that `./SKILL.md` produced the name ".". No other serious finding. |
| Browser fixtures. | 40 scenario, theme, and size combinations passed: the four Fold postures and a 280 px pane, in both themes, closed, open, and running. Records and open bodies stayed inside the column. The chip kept a 44 px target. Enter opened both record kinds and kept focus. No API mutations or browser exceptions occurred. |
| Visual review. | 32 posture captures were read, in four labelled contact sheets and seven single captures. The long skill name truncates on the line and appears in full when the record opens. |
| Real history. | Read-only check of session `01a0ef0c-343b-70d6-902d-d26b3d5b1af9`: 20 invocations, 6 skill loads, and 133 other tool calls each rendered once. No load sat inside the activity disclosure, no bubble showed a raw block, and the page did not overflow. |

Evidence stays under the ignored `verification/local/skills/` and `verification/local/real-skills/` directories and `/tmp/aui-skills-shots/`. Physical Fold touch and keyboard checks remain unverified.
