import type { ReactNode } from "react";

/** Draws a session's Skills and prompts sheet over its chat. The entry passes the binding in. */
export type ResourceLensRenderer = (session: { id: string; cwd: string; onClose: () => void }) => ReactNode;
