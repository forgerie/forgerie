---
"forgerie": minor
---

Let agents run Pi's `codemode` tool in hosted sessions. An agent can write one
JavaScript script that calls the other tools, and only what the script prints
goes back to the model. The transcript shows a script as one step: its detail
shows the highlighted script, one row for each call the script made with its
status and time, and the output. The live status line names the call that the
script is making. The tool is on by default; turn it off with
**Settings → Session daemon → Allow agents to run scripts**, the `codemode`
config key, or `PI_WEB_CODEMODE=false`. Scripts cannot call `ask_user`,
`handoff_session`, `spawn_session`, `spawn_subsession`,
`yield_to_subsessions`, or `subagent`.
