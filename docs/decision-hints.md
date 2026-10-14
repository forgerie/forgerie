# Decision hints

Decision hints is an optional gateway connection. It starts off. Attention
triage uses the shared settings and client. Risk labels are a separate integration.

When enabled, turn replies and commands leave this machine through the gateway.
Enable it only for a gateway you trust. A hint can add information only. It must
not hide or demote a session, change a gate, or make a turn or command wait.
Failures return no opinion and retain today's behavior.

## Configuration

Open Settings > Plugins > Decision hints. Set the gateway base address and its
model name, then turn the plugin on. The default model is `fast`. Attention hints
and risk labels each have a switch. Sensitivity offers `low`, `normal` (default)
and `high`.

The same settings live in Forgerie's config (`~/.config/forgerie/config.json`, or
`PI_WEB_CONFIG`):

```json
{
  "plugins": {
    "decision-hints": {
      "enabled": true,
      "settings": {
        "gateway_url": "http://127.0.0.1:4000",
        "model": "fast",
        "attention": true,
        "risk_labels": true,
        "sensitivity": "normal"
      }
    }
  }
}
```

Use a base address without `/v1/systemone`. Forgerie posts to
`<baseUrl>/v1/systemone`. An empty address disables requests. Settings changes
apply to the next background ask without a sessiond restart. An unreadable config
means no hints. An ask already sent cannot be unsent by turning the plugin off;
consumers must check the live setting before publishing its result.

## Gateway key

Set `DECISION_GATEWAY_API_KEY` in the **sessiond service environment**. Restart
sessiond after changing the key; it captures its private environment at startup.
The gateway receives it as a Bearer token. A gateway without authentication can
leave this variable unset. This foundation uses the environment only, not a
profile key file.

Do not put a key in plugin settings, the gateway URL, or browser storage. Sessiond
removes this variable before agent bash processes can start. Managed processes
also filter it out. This is environment isolation, not a sandbox against an agent
reading host files.

The plugin form has no secret field. The existing status endpoint
`GET /api/pi-web/runtime` reports only
`components.sessiond.decisionHints.keyPresent`. This reports presence, not whether
the gateway accepts the key. The interface stage can display this status.

## Risk labels

With the master switch and `risk_labels` on and an address configured, Forgerie
starts one background ask after each new gate admission and for each SDK or
native child `bash` invocation. A replayed gate does not send another ask.
Approval can cause a second ask when the saved bash call actually executes.
The gateway receives the tool name, JSON arguments limited to 8000 characters,
and execution cwd. Gate asks also include category and description (limited to
4000 characters). Arguments are not secret-redacted. Do not enable this feature
for commands whose arguments must not leave the machine.

The questions ask whether the call deletes or overwrites data, acts outside its
cwd, or acts under the user's name outside this machine. These three `noul`
answers are numbers from 0 to 1. The risk score runs from 0 to 2 for `low`,
`check`, and `danger`; the nearest score selects the label. The original score
and the answering model are retained. A low label is not "safe to approve".
Sensitivity does not alter risk labels.

Gate responses add optional `riskLabel` to the gate record. The shape is
`{model, deletes_data, outside_worktree, acts_as_user, risk, risk_score}`.
A separate journal transaction updates only this field, even if approval,
refusal, or execution has finished. It also appends a display-only
`forgerie.risk-label` entry `{target:"gate", id, label}`. Label-only commits
refresh the gate read without recounting Needs your response.

Bash responses append the same display-only entry with `target:"tool"` and the
tool call ID. The existing message stream delivers it live. The transcript
folds it into that call's `riskLabel`, carried in the UI tool-call artifact.
Native child transcripts project and poll the same durable entries. Entries
and gate labels survive restart; ordinary bash cards recover their label on
reload. Nested SDK bash labels are live when their nested call row exists;
those nested call rows are not themselves persisted by the SDK adapter, so a
reload can retain the annotation without showing a nested row.

The initial UI adds only `data-risk-label` JSON attributes on existing gate,
bash, and child call markup. Visual labels remain a later design stage. No
new row, scroll, choice, or approval recommendation is added.

No call awaits a gateway response. A disabled feature, empty address, invalid
answer, timeout, or gateway failure adds nothing. Turning either switch off
before an answer arrives discards that late answer. Already stored annotations
remain history. Storage errors are reported through the session's extension
error channel; they never alter gate state or tool results.

## Maintainer contract

Inject `DecisionHints` through `PiSessionServiceDependencies.decisionHints`.
`readSettings()` re-reads the config. Launch `client.ask(request)` in the
background; never await it in turn completion, gate admission, or tool execution.
The client returns the answering model and validated answers, or `undefined` for
no opinion. It refuses redirects and does not use a provider SDK.

The client timeout defaults to 2000 ms; composition can supply `timeoutMs`.
Use `assertDecisionHintOffEquivalence` from
`src/server/decisions/decisionHintsOffEquivalence.testSupport.ts` for consumer
tests. It compares immediate and settled observations for baseline, off,
unconfigured, unreachable and hanging gateway runs. It also rejects a scenario
that waits for the hanging gateway timeout. See its tests for an example.

## Attention triage

With Attention enabled, each settled agent turn sends one background ask. The
state contains the final assistant reply's visible text (at most 8192 characters)
and the declared awaiting state (`nothing`, `reply`, or `undeclared`). Thinking
and earlier narration are not sent. The questions classify the reply as
`decision`, `review`, `blocked`, `failed`, `done`, or `fyi`; estimate whether it
asks the user to answer, decide or approve; score urgency as low, normal or high;
and estimate whether it announces work it did not do in this turn.

Today's rules draw rows first. Only an Unread row can gain the inferred
`likelyNeedsYou` flag and move to Needs your response. The larger of the
asks-user and stopped-early probabilities must meet the inclusive threshold:

| Sensitivity | Promotion threshold |
| --- | --- |
| high | 0.60 |
| normal | 0.75 |
| low | 0.90 |

A declared response request stays a response request. Open, Working, Errored and
Archived rows do not move because of a hint. Needs your response orders by
high, normal, then low urgency, followed by recency. Unknown urgency ranks as
normal. Pinned rows keep their existing section and recency order before the
other sections. Project grouping retains its existing pinned-first recency order.
Kind and urgency reach the view model only at confidence 0.75 or above. Urgency
uses the nearest score level (0 = low, 1 = normal, 2 = high).

The server selects display fields using live settings. The browser receives an
optional `SessionStatus.attentionHint` through the existing `status.update`:

```ts
{
  turnId: string;
  model: string; // answering model, not necessarily the requested alias
  at: string; // ISO timestamp
  likelyNeedsYou: boolean;
  kind?: "decision" | "review" | "blocked" | "failed" | "done" | "fyi";
  urgency?: "low" | "normal" | "high";
}
```

Raw probabilities stay on the server. Turning either switch off suppresses hints
on the next status read or publication. A late answer re-checks live settings and
turn identity before storage and publication. No gateway result changes the
session response, admits a command, or delays the turn end.

Hints use the native session journal's rewindable `ExtensionEntries` metadata
family, as session response declarations do. The journal stores probabilities,
answering model, timestamp and turn identity. Queued user input and a new run
invalidate the old hint immediately and write a background tombstone. A reply
from an older turn cannot promote a newer one. Optional writes use their own
native commit instead of the SDK metadata intent queue, so a hint write failure
does not poison later response declarations. Persistence errors are logged.

Browser reload retains live-session hints. After a daemon restart, persisted
hints return when that session's runtime opens (for example, on a status request
or selecting the session). The cold catalog does not open all inactive journals
just to read hints. This limits restart discovery but avoids per-session database
reads for a large picker. The current UI exposes data attributes only; a later
design stage will add the inferred-attention mark and label.
