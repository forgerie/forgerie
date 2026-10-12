import { Diagram } from "./Diagram";

export const name = "Diagram";
export const note = "A Mermaid diagram; shows its source until drawn, and when the source is invalid";

export default function Flow() {
  return <Diagram code={"flowchart LR\n  Browser --> Web[web server]\n  Web --> Sessiond\n  Sessiond --> Model\n  Sessiond --> Disk[(session journal)]"} />;
}
export function Sequence() {
  return <Diagram code={"sequenceDiagram\n  participant B as Browser\n  participant S as Sessiond\n  participant M as Model\n  B->>S: prompt\n  S->>M: system prompt + guide\n  M-->>S: streamed reply\n  S-->>B: events"} />;
}
export function Wide() {
  return <Diagram code={"flowchart LR\n  A[Bump version] --> B[Build] --> C[Run tests] --> D[Write notes] --> E[Tag release] --> F[Publish] --> G[Announce]"} />;
}
export function Invalid() {
  return <Diagram code={"flowchart LR\n  A --> \n  this is not mermaid ((("} />;
}
