import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function searchEntry(id: string, parentId: string | null, text: string, role = "user", timestamp = "2026-01-01T00:00:00.000Z"): Record<string, unknown> {
  return { type: "message", id, parentId, timestamp, message: { role, content: [{ type: "text", text }], timestamp: Date.parse(timestamp) } };
}

export async function writeSearchSession(path: string, id: string, entries: unknown[] = [searchEntry("first", null, "searchable message")], options: { cwd?: string; child?: boolean } = {}): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, [{ type: "session", version: 3, id, cwd: options.cwd ?? "/repo", timestamp: "2026-01-01T00:00:00.000Z", ...(options.child === true ? { agentSpawned: true } : {}) }, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
}
