// Read-only. Loads a real session's history from Forgerie and checks that the
// transcript keeps every renderable tool image the API returns.
// Run: nix shell nixpkgs#nodejs_22 -c ../../node_modules/.bin/tsx scripts/real-images-check.ts <sessionId> <cwd>
import assert from "node:assert/strict";
import { historySchema } from "../src/contracts";
import { fromHistory } from "../src/transcript";

const [id, cwd] = process.argv.slice(2);
if (!id || !cwd) throw new Error("Usage: real-images-check.ts <sessionId> <cwd>");
const api = process.env.API_URL ?? "http://127.0.0.1:8504";
const response = await fetch(`${api}/api/sessions/${encodeURIComponent(id)}/messages?${new URLSearchParams({ cwd })}`);
assert.equal(response.status, 200, `history: HTTP ${response.status}`);
const history = historySchema.parse(await response.json());
const raw = history.messages.filter((message) => message.role === "toolResult").flatMap((message) =>
  Array.isArray(message.content) ? message.content.filter((part): part is { type: string; data?: string; mimeType?: string } =>
    typeof part === "object" && part !== null && "type" in part && part.type === "image") : []);
const renderable = raw.filter((part) => part.data && ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(part.mimeType ?? ""));
const transcript = fromHistory(history.messages);
const kept = transcript.messages.flatMap((message) => message.parts.flatMap((part) =>
  part.type === "tool" && part.state.type === "done" ? part.state.images ?? [] : []));
console.log(JSON.stringify({ messages: history.messages.length, toolImages: raw.length, renderable: renderable.length, kept: kept.length,
  mimeTypes: [...new Set(raw.map((part) => part.mimeType))] }));
assert.ok(raw.length > 0, "the session must contain tool images");
assert.equal(kept.length, renderable.length, "every renderable tool image reaches the transcript");
console.log("real images check: passed");
