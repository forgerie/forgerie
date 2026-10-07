# Structured diff annotations in prompts

The backend accepts an optional `diffAnnotations` array on
`POST /api/machines/:machineId/sessions/:sessionId/prompt`.
The daemon's corresponding route is `/sessions/:sessionId/prompt`.

The user chose structured annotation input on 2026-10-07. The backend validates
the entire batch and formats it as prompt text before session mutations.
There is no annotation store or new delivery queue. Ordinary requests remain
unchanged. The frontend must send this field to use the structured contract.
Client-formatted notes in `text` remain ordinary text.

## Request

```json
{
  "cwd": "/repo",
  "text": "Fix these issues.",
  "streamingBehavior": "followUp",
  "diffAnnotations": [
    {
      "path": "src/retry.ts",
      "staged": false,
      "comment": "Keep the retry limit.",
      "lines": [
        { "kind": "remove", "oldLineNumber": 8, "text": "const retries = 3;" },
        { "kind": "add", "newLineNumber": 8, "text": "const retries = 0;" }
      ]
    }
  ]
}
```

`lines` are selected code rows, in diff order. Do not include hunk headers or
file headers. Row `text` excludes the diff prefix. A `context` row requires
both `oldLineNumber` and `newLineNumber`. An `add` row requires only
`newLineNumber`. A `remove` row requires only `oldLineNumber`. Omit absent
positions rather than sending `null`. Each side's positions must increase.
They can skip positions when a selection crosses hunks.

The schema and inferred annotation type live in
`src/shared/promptDiffAnnotations.ts`. Unknown annotation or row fields are
rejected. Paths must be relative, slash-separated paths without traversal,
control characters, backslashes, or drive prefixes. Paths identify excerpts;
they do not grant access to files.

With at least one annotation, `text` can be omitted or empty. Existing
`attachments` and `streamingBehavior` fields keep their behavior. An absent
or empty annotation array does not change existing prompt validation.

## Bounds and failures

| Input | Bound |
|---|---:|
| Annotations per prompt | 16 |
| Selected rows per annotation | 200 |
| Path length | 1,024 characters |
| Comment length | 4,096 characters, with non-whitespace content |
| Row text length | 4,096 characters, without newline, carriage return, or NUL |
| Combined path, comment, and row text | 65,536 UTF-16 code units |
| Line numbers | Positive safe integers |

Malformed or oversized annotations return HTTP 400 with the existing
`{ "error": "..." }` contract. Validation failure does not open a runtime,
submit part of the batch, or publish a user message. Normal session errors
remain unchanged.

## Delivery and limitations

The server joins the user's text and annotation blocks into one prompt.
Each block includes the quoted path, staged state, old/new line ranges,
per-row old/new positions, a diff excerpt, and the comment. Per-row positions
preserve gaps when a selection crosses hunks. Code fences exceed any backtick sequence
in the excerpt. The ordinary prompt service owns delivery, transcript echoes,
steering, deduplication, and waits behind compaction.

Excerpts are caller-supplied snapshots. The backend does not read files,
compare diff hashes, or certify that these positions still match current code.
The prompt states that distinction. This preserves the code the user reviewed
without a filesystem race, but the agent must check current code before editing.

This backend slice does not change the frontend. It does not add annotation
persistence, GitHub review comments, or support to the prompt-resource-command
endpoint.
