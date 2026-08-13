/** PROTOTYPE — fake Forgerie content. Nothing here talks to a server. */

export const transcript = [
  {
    role: "human",
    ref: "msg:1",
    blocks: [{ kind: "prose", ref: "msg:1#p1", text: "The archive endpoint drops sessions when two machines write at once. Find out why." }],
  },
  {
    role: "agent",
    ref: "msg:2",
    blocks: [
      { kind: "prose", ref: "msg:2#p1", text: "I read the archive writer. It rewrites the whole index file per call, so the last writer wins." },
      {
        kind: "code",
        ref: "src/server/sessions/archive.ts",
        startLine: 108,
        lines: [
          "export async function archiveSession(id: string): Promise<void> {",
          "  const index = await readIndex();",
          "  index.archived.push(id);",
          "  await writeFile(indexPath, JSON.stringify(index));",
          "}",
        ],
      },
      { kind: "prose", ref: "msg:2#p2", text: "Two daemons can read the same index, then both write it. The second write erases the first entry." },
    ],
  },
  {
    role: "tool",
    ref: "msg:3",
    title: "run · npm test -- archive",
    blocks: [
      {
        kind: "output",
        ref: "tool:3",
        lines: [
          "FAIL src/server/sessions/archive.test.ts",
          "  ✕ keeps both entries when two writers race (128 ms)",
          "  Expected length: 2",
          "  Received length: 1",
        ],
      },
    ],
  },
  {
    role: "agent",
    ref: "msg:4",
    blocks: [
      { kind: "prose", ref: "msg:4#p1", text: "A file lock would fix the race. An append-only log would remove the shared write completely. Which do you want?" },
    ],
  },
];

export const diff = {
  file: "src/server/sessions/archive.ts",
  hunks: [
    {
      header: "@@ -104,12 +104,18 @@",
      lines: [
        { kind: "context", n: 104, text: "import { readFile, writeFile } from \"node:fs/promises\";" },
        { kind: "add", n: 105, text: "import { withIndexLock } from \"./indexLock\";" },
        { kind: "context", n: 106, text: "" },
        { kind: "context", n: 107, text: "export async function archiveSession(id: string): Promise<void> {" },
        { kind: "del", n: 108, text: "  const index = await readIndex();" },
        { kind: "del", n: 109, text: "  index.archived.push(id);" },
        { kind: "del", n: 110, text: "  await writeFile(indexPath, JSON.stringify(index));" },
        { kind: "add", n: 108, text: "  await withIndexLock(async () => {" },
        { kind: "add", n: 109, text: "    const index = await readIndex();" },
        { kind: "add", n: 110, text: "    index.archived.push(id);" },
        { kind: "add", n: 111, text: "    await writeFile(indexPath, JSON.stringify(index));" },
        { kind: "add", n: 112, text: "  });" },
        { kind: "context", n: 113, text: "}" },
      ],
    },
  ],
};
