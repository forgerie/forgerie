import type { SessionOpenReceipt } from "@shared/sessionOpen";
import { z } from "zod";
import type { SessionTransport } from "./sessionStore";
import type { Session } from "./contracts";

const safeOrder = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const catalogSchema = z.object({
  catalogId: z.string().min(1),
  sessions: z.array(z.object({ sessionId: z.string().min(1), cwd: z.string().min(1), completionOrder: safeOrder })),
});
export interface ReadReceipt { session: Session; catalogId: string; throughCompletionOrder: number }
export interface ReadTracker {
  capture(session: Session, signal: AbortSignal): Promise<ReadReceipt | undefined>;
  acknowledge(receipt: ReadReceipt, signal: AbortSignal): Promise<void>;
  observe(listener: (sessionId: string, receipt?: SessionOpenReceipt) => void): () => void;
  isVisible(): boolean;
}

/** No client read flag. The daemon applies a guarded, monotonic acknowledgement. */
export function createReadTracker(transport: Pick<SessionTransport, "request">, options: {
  isVisible: () => boolean;
  subscribe?: ((listener: (sessionId: string, receipt?: SessionOpenReceipt) => void) => () => void) | undefined;
  afterRender?: ((signal: AbortSignal) => Promise<void>) | undefined;
}): ReadTracker {
  return {
    isVisible: options.isVisible,
    observe: (listener) => options.subscribe?.(listener) ?? (() => {}),
    async capture(session, signal) {
      if (!options.isVisible()) return undefined;
      const response = await transport.request("/api/sessions/unread", { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
      if (!response.ok) throw new Error(`Read boundary failed: HTTP ${response.status}`);
      const catalog = catalogSchema.parse(await response.json());
      const unread = catalog.sessions.find((entry) => entry.sessionId === session.id && entry.cwd === session.cwd);
      return unread ? { session, catalogId: catalog.catalogId, throughCompletionOrder: unread.completionOrder } : undefined;
    },
    async acknowledge(receipt, signal) {
      if (!options.isVisible() || signal.aborted) return;
      await options.afterRender?.(signal);
      if (!options.isVisible() || signal.aborted) return;
      const response = await transport.request(`/api/sessions/${encodeURIComponent(receipt.session.id)}/unread/acknowledge`, {
        method: "POST", signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: receipt.session.cwd, catalogId: receipt.catalogId, throughCompletionOrder: receipt.throughCompletionOrder }),
      });
      if (!response.ok) throw new Error(`Read acknowledgement failed: HTTP ${response.status}`);
      // The global catalog event owns the visual change. Never optimistically clear it here.
      catalogSchema.parse(await response.json());
    },
  };
}
