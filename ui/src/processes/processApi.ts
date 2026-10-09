// Reads a managed process's recent output through
// GET /api/sessions/:id/processes/:processId/output (src/server/sessions/processRoutes.ts).
import { z } from "zod";

const outputSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), lines: z.array(z.object({ type: z.enum(["stdout", "stderr"]), text: z.string() })) }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
const reasons: Record<string, string> = {
  not_found: "The process is no longer tracked. Its output is gone.",
  unavailable: "The process manager is not running in this session.",
};

export type Request = (path: string, init: RequestInit) => Promise<Response>;

/** Recent output as text, newest last. Throws a readable message on failure. */
export async function loadProcessOutput(request: Request, session: { id: string; cwd: string }, processId: string, tailLines = 60): Promise<string> {
  const query = new URLSearchParams({ cwd: session.cwd, tailLines: String(tailLines) });
  const response = await request(`/api/sessions/${encodeURIComponent(session.id)}/processes/${encodeURIComponent(processId)}/output?${query}`,
    { signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = outputSchema.parse(await response.json());
  if (!result.ok) throw new Error(reasons[result.reason] ?? result.reason);
  return result.lines.map((line) => line.text).join("\n");
}
