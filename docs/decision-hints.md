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

Set a key in **Settings > Plugins > Decision hints > Gateway key**. The password
input is never prefilled. Use Save (or Replace) to set it, and Remove to clear it.
Forgerie stores it in `<active agent profile>/decision-gateway.json`, next to
`auth.json` and `cliproxyapi.json`, as `{ "apiKey": "…" }`. The file has mode
`0600`. Writes use a private temporary file and an atomic rename. It does not go
in the browser-readable global config or plugin settings.

Alternatively, set a non-empty `DECISION_GATEWAY_API_KEY` in the **sessiond service
environment**. The environment value takes precedence over the file. Settings
shows that source and disables Save, Replace and Remove, because the UI cannot
change an environment value. Changing a service environment still requires a
sessiond restart to give the process the new value.

File changes need **no restart**. Sessiond reads the effective key on each gateway
request asynchronously and caches the file by mtime, size and inode. Credential
I/O runs inside the detached ask, not on the turn or tool stack. Set, replace and clear apply
to the next request; a request already sent keeps its original authorization.
The gateway receives the key as a Bearer token. With no key, Forgerie sends requests
without `Authorization`, so gateways without authentication still work. A damaged
or unreadable key file stops the optional ask instead of sending it without auth.
Settings shows **Saved key file is unreadable**, keeps the input empty, and allows
Replace with a new key or Remove. Empty files, malformed JSON and empty `apiKey`
values all use this repairable state.

**Security cost:** agent `bash` runs as the same Unix user as Forgerie. It can read
the profile key file despite mode `0600`. This is already true of `auth.json` and
`cliproxyapi.json`. The file is not hidden from agents. Users who need agents
unable to read this key must use the environment variable instead and must remove
any key file. Sessiond scrubs that variable before agent bash and managed processes
start. This environment isolation is not a sandbox against host file access.

Do not put a key in plugin settings, the gateway URL, or browser storage. Read
routes report only `{ keyPresent, source }`, where source is `environment`,
`settings` or `none`. An invalid file reports
`{ keyPresent: false, source: "settings", invalid: true }`. They never return the
key, a prefix, hash or length. Presence
does not mean the gateway accepts the key. The write-only Settings routes are:

- `GET /aui/plugins/decision-hints/gateway-key`: public status only.
- `POST /aui/plugins/decision-hints/gateway-key`: `{ revision, apiKey }`.
- `POST /aui/plugins/decision-hints/gateway-key/clear`: `{ revision }`.

Both writes use the current plugin catalog revision and Settings' same-origin
protection. They return only public status. The revision covers plugin settings
and the active profile, not a credential fingerprint. A key change deliberately
replaces the value without reading it; simultaneous key writes are last-writer
wins. Values are trimmed, non-empty, at most 4096 characters, and cannot contain
control characters. The runtime endpoint also includes public status at
`components.sessiond.decisionHints`.

Browser file APIs exclude the active profile's key file and private temporary
writes, even when allowed roots include the profile. Checks use canonical paths
and device/inode identity, including symlinks and hard links. File reads, previews,
tree/search results, resource content, process output and Git patches must not
expose those files or their content fingerprints. This is a file-identity boundary,
not a content scanner for copies an agent made or old committed copies. Existing
`auth.json` and `cliproxyapi.json` browser exposure is unchanged by this exclusion.

Key-bearing web-to-sessiond requests never follow redirects. Every 3xx response
fails with fixed text, without reading or forwarding the redirect body.

## Risk labels

With the master switch and `risk_labels` on and an address configured, Forgerie
starts one background ask after each new gate admission and for each SDK or
native child `bash` invocation. A replayed gate does not send another ask.
Approval can cause a second ask when the saved bash call actually executes.
The gateway receives the tool name, JSON arguments limited to 8000 characters,
and execution cwd. Gate asks also include category and description (limited to
4000 characters). Before applying these limits or sending the request, a pure
redaction step replaces likely secrets with `[redacted]`. It covers authorization
headers (including X-Api-Key, X-Auth-Token, Cookie, Set-Cookie and
Proxy-Authorization), curl `-u`/`--user` credentials, secret-bearing flags and
environment assignments, URL credentials,
sensitive JSON fields, common OpenAI/GitHub/Slack/AWS key formats, and long opaque
credential-like strings. It keeps command verbs, flag names and ordinary
configuration readable. The same step covers gate descriptions and other state
text, including cwd when repeated in a question.

Redaction changes only the outbound payload. Saved gate arguments, transcript
commands, tool execution and gate decisions stay exact. Detection is heuristic:
it can miss secrets and can hide non-secret strings. Do not enable this feature
for commands whose contents must not leave the machine, even after redaction.

The questions ask whether the call deletes or overwrites data, acts outside its
cwd, or acts under the user's name outside this machine. These three `noul`
answers are numbers from 0 to 1. The risk score runs from 0 to 2 for `low`,
`check`, and `danger`; the nearest score selects the label. The original score
and the answering model are retained. A low label is not "safe to approve".
Sensitivity does not alter risk labels.

Gate responses add optional `riskLabel` to the gate read model. The shape is
`{model, deletes_data, outside_worktree, acts_as_user, risk, risk_score}`.
Labels live in an independent in-memory store, keyed by session family,
conversation and gate ID. They never update the gate document, decisions,
execution intent, tasks or Needs your response.

Bash labels use a stable invocation identity: conversation ID, source assistant
entry ID, model call ID and nested-call ordinal. Repeated model call IDs in later
turns cannot reuse or overwrite another invocation's label. Parent and child
projections carry a `toolInvocations` map plus optional `decisionAnnotations`
metadata on their existing assistant messages. Each tool annotation contains
`{target:"tool", id, invocationId, sourceInvocationId, label}`. The source identity
places a nested label on its originating turn; the full identity distinguishes
nested calls. The UI matches the full identity, never the model call ID alone.

History pagination and validation run on required messages first. Only then are
annotations added as metadata. Labels add no messages and change no counts,
cursors, page boundaries or the 500-message safety limit. The SDK event path can
send a transient `forgerie.risk-label` notification; it is not a history row or
model input. Native child transcript polls use the same count-preserving overlay.
Nested SDK call rows remain live-only, so their metadata can exist without a
corresponding nested row after browser reload.

The shared attention/risk cache retains at most **2048 records** and approximately
**2 MiB per family**. The byte estimate counts UTF-8 serialized values, scope/key
text and 64 bytes per record. The cache evicts oldest insertions first across all
conversations; replacing a record does not refresh its age. A single oversized
result is dropped without clearing existing records. These bounds can remove an
older opinion, never required history or state.

Browser reload recovers retained labels while the family stays open. Releasing
one sibling lease does not clear them. The last lease or pool shutdown closes the
whole family: it clears records and listeners before closing the harness, seals
the store, and discards queued or late results. A reopened family starts empty.
Restarting sessiond also loses all annotations.

The gate card and the bash line draw the label (see
[What you see](#what-you-see)). Child call rows in a child's exchange log keep
only the `data-risk-label` JSON attribute. No new row, choice, or approval
recommendation is added.

No call awaits a gateway response. A disabled feature, empty address, invalid
answer, timeout, or gateway failure adds nothing. Turning either switch off
before an answer arrives discards that late answer. Turning either switch off
also hides already stored labels on subsequent history, snapshot, gate and child
reads. Re-enabling can show retained labels until eviction or family close.
Annotation errors are reported through the session's extension error channel.
They cannot poison Durable because no optional write calls its harness or storage.

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
and the declared awaiting state (`nothing`, `reply`, or `undeclared`). A shared
payload scrubber redacts likely credentials before this limit is applied. Thinking
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

Rows that today's rules place in Needs your response receive no hint mark,
kind or urgency. Their existing recency order stays exact, and they come before
all hint-promoted rows. Only hint-promoted rows then sort by high, normal, low
urgency and recency; unknown urgency ranks as normal. Open, Working, Errored and
Archived rows do not move because of a hint. Pinned rows keep their existing
section and recency order before other sections. Project grouping retains its
existing pinned-first recency order. Only baseline Unread rows can receive kind
and urgency, each at confidence 0.75 or above. Urgency uses the nearest score
level (0 = low, 1 = normal, 2 = high).

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
turn identity before storage and publication. Closing, replacing or disposing a
runtime retires its pending attention request. A closed, oversized or otherwise
discarded cache write is not a publication success. Hint-result publication
checks the active session object, so an old hint cannot overwrite a reopened
runtime's response. Only attention and the optional risk-label observer use this
stricter publication boundary. Existing startup dialogs, PR watches, managed
processes, compaction, gate changes and child-status notifications keep their
original publication behavior. In particular, a startup dialog must publish
Needs your response before its runtime becomes active. No gateway result changes the
session response, admits a command, or delays the turn end.

Native open cuts cache required data only. HTTP responses and each subscriber
delivery attach risk annotations after required paging and validation, with a
fresh check of the live switches. This includes new attachments and queued
replacements. Source-entry provenance stays outside the cut in weak metadata;
no cached cut contains `decisionAnnotations`, `toolInvocations` or switch state.
A late annotation refreshes only a live native publisher and advances its
transport sequence, not its history identity. It writes no Durable entry.

Hints use the same independent in-memory annotation store as risk labels, not
the Durable journal or SDK metadata queue. They retain probabilities, answering
model, timestamp and turn identity only while the session family stays open.
Queued user input and a new run invalidate the old hint immediately. No
invalidation writes a tombstone while attention is off or unconfigured. In all
modes, hints and labels make zero writes to required session storage.

Browser reload retains live-session hints. Closing the session family or
restarting sessiond loses them. The next completed turn can obtain a new hint.
This loss is deliberate: an ordinary storage error in any Durable commit can
poison the required journal even if SQLite rolled it back. A separate native
commit is not an isolation boundary. Keeping optional annotations outside that
journal makes optional failures unable to block declarations, gate decisions,
execution intent or results. No storage error is reclassified as safe, and
`node_modules` remains unchanged. See [What you see](#what-you-see) for the
picker's mark and label.

## What you see

With the plugin off, or with no hint or label yet, every surface looks as it
did before. Hints and labels only add.

### Session list

A row that a hint moved to **Needs your response** has a hollow square mark. A
session whose agent asked for a response keeps the filled square. The hint is
a guess; the filled square is a request.

The row's second line adds a short muted word after the project:

| Row | Word | Screen readers and hover |
| --- | --- | --- |
| Moved by a hint, with a kind | `Decision`, `Review`, `Blocked`, `Failed`, `Done` or `FYI` | "Likely needs you: review" |
| Moved by a hint, without a kind | `Likely needs you` | "Likely needs you" |
| Unread, not moved, with a kind | The kind | "Hint: done" |

High urgency draws the word in full ink and weight with a small double-chevron
mark, and adds "high urgency" to the spoken text. It uses no signal colour.
Low and normal urgency look the same. A read row (Open) shows no word, even if
its last hint had a kind. In a narrow list the project name and the word both
shrink to an ellipsis; the hover text and the spoken text keep the whole
statement.

### Gate card and bash line

A risk label is an opinion, never permission. Its three levels:

| Level | Word | Look |
| --- | --- | --- |
| `low` | Low risk | Muted ink, an info icon. No green and no check mark. |
| `check` | Check first | Warn ink and an alert-circle icon. |
| `danger` | High risk | Destructive ink and a warning-triangle icon. |

The words name the raised signals: "deletes data", "outside the working
directory", and "acts as you". A signal counts as raised at a probability of
0.5 or above. The label ends with "Opinion from" and the answering model.

On a gate card the label is one sentence right above Refuse and Approve and
run, for example "High risk: deletes data, outside the working directory.
Opinion from fast." It stays on the card after the decision. When the card is
pinned in a short pane, the choices sit beside the title and the label follows
them.

On a bash line, the line ends with the icon and word. The signals and the
model are in the hover text and the line's spoken name. Opening the line shows
the full sentence above Input and Output.

A label usually arrives after the card or line. It fades in. On a bash line it
takes width from the command text, never height. On a gate card the choices
stay where they were: a pinned card's list grows upward, and a card in a
scrolling thread scrolls by the label's height. With reduced motion the label
appears without the fade.

### Settings

Settings > Plugins > Decision hints shows a **Gateway key** row under the
gateway address, even when the plugin is off. It reads `GET /api/pi-web/runtime`
when the page opens:

| Value | Controls |
| --- | --- |
| Set here | Empty password input, Replace and Remove. |
| Set by DECISION_GATEWAY_API_KEY | Disabled controls; Settings cannot change an environment key. |
| Not set | Empty password input and Save. Remove is disabled. |
| Unknown | Disabled controls. Check that sessiond is running. |

The input clears after a save attempt. The page never receives the saved key.
