import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import { BacklogMetadataSchema, type BacklogMetadata } from "../../shared/backlog.js";

export function parseBacklogItem(content: string): { metadata: BacklogMetadata; body: string } {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(content);
  if (opening === null) throw new Error("Item requires YAML frontmatter with id and title");
  const remaining = content.slice(opening[0].length);
  const closing = /^---[ \t]*(?:\r?\n|$)/m.exec(remaining);
  if (closing === null) throw new Error("Unterminated item frontmatter");
  const end = opening[0].length + closing.index + closing[0].length;
  const parsed: unknown = parseFrontmatter(content.slice(0, end)).frontmatter;
  if (!Check(BacklogMetadataSchema, parsed)) throw new Error("Invalid item frontmatter: id and title are required; labels and blocked_by must be string arrays");
  if (parsed.id.trim() === "" || parsed.title.trim() === "") throw new Error("Item id and title must not be blank");
  if (parsed.created !== undefined && !Number.isFinite(Date.parse(parsed.created))) throw new Error("Invalid created date");
  // Pi's parser trims and normalizes its body. Only use its YAML result here.
  const metadata: BacklogMetadata = {
    id: parsed.id, title: parsed.title,
    ...(parsed.status === undefined ? {} : { status: parsed.status }),
    ...(parsed.priority === undefined ? {} : { priority: parsed.priority }),
    ...(parsed.labels === undefined ? {} : { labels: parsed.labels }),
    ...(parsed.created === undefined ? {} : { created: parsed.created }),
    ...(parsed.source === undefined ? {} : { source: parsed.source }),
    ...(parsed.blocked_by === undefined ? {} : { blocked_by: parsed.blocked_by }),
  };
  return { metadata, body: content.slice(end) };
}

export function isOpenBacklogStatus(status: string): boolean {
  return !new Set(["done", "closed", "completed", "cancelled", "canceled"]).has(status.trim().toLowerCase());
}
