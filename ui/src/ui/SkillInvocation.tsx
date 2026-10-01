import type { DataMessagePartProps } from "@assistant-ui/react";
import { ChevronDownIcon, ScrollTextIcon } from "lucide-react";
import { useState } from "react";
import type { SkillRecord } from "../transcript";
import { clipOutput } from "../toolSummary";

function isSkillRecord(value: unknown): value is SkillRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record["name"] === "string" && typeof record["location"] === "string" && typeof record["content"] === "string";
}

/**
 * The `/skill:name` command a person sent. Like an attachment, it rides on
 * their message: the command stays visible and the skill's own text, which Pi
 * inserted into the prompt, opens on request. The typed argument stays in the
 * message bubble.
 */
export function SkillInvocationRecord({ data }: DataMessagePartProps) {
  const [open, setOpen] = useState(false);
  if (!isSkillRecord(data)) return null;
  const clipped = clipOutput(data.content);
  return <details className="skill-invocation" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="skill-chip" title={`Show the text of the ${data.name} skill`}>
      <ScrollTextIcon aria-hidden size={14} />
      <code>/skill:{data.name}</code>
      <ChevronDownIcon aria-hidden size={14} className="skill-chip-chevron" />
    </summary>
    {open ? <div className="skill-invocation-body">
      <p className="skill-location">From <code>{data.location}</code></p>
      <pre className="trace-pre" tabIndex={0}>{clipped.text}</pre>
      {clipped.hidden > 0 ? <p className="trace-empty">{clipped.hidden.toLocaleString()} more characters not shown.</p> : null}
    </div> : null}
  </details>;
}
