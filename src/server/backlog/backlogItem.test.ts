import { describe, expect, it } from "vitest";
import { isOpenBacklogStatus, parseBacklogItem } from "./backlogItem.js";

describe("backlog item contract", () => {
  it("parses the A4 fields, ignores unknown metadata, and preserves the exact body", () => {
    const body = "\r\n# Heading\r\n  indented  \r\n\r\n";
    const item = parseBacklogItem(`---\r\nid: ITEM-1\r\ntitle: 'A: title'\r\nstatus: To Do\r\npriority: high\r\nlabels: [api, server]\r\ncreated: 2026-09-01\r\nsource: se-debug\r\nblocked_by:\r\n  - ITEM-2\r\ncontext:\r\n  arbitrary: true\r\nclaimed_by: not-a-real-claim\r\n---\r\n${body}`);
    expect(item).toEqual({ metadata: { id: "ITEM-1", title: "A: title", status: "To Do", priority: "high", labels: ["api", "server"], created: "2026-09-01", source: "se-debug", blocked_by: ["ITEM-2"] }, body });
  });
  it.each(["# no frontmatter", "---\nid: x\n", "---\nid: x\n---\nbody", "---\nid: x\ntitle: X\nlabels: wrong\n---\n", "---\nid: x\ntitle: X\nblocked_by: [1]\n---\n", "---\nid: x\ntitle: X\ncreated: nonsense\n---\n"]) ("rejects malformed metadata %s", (content) => {
    expect(() => parseBacklogItem(content)).toThrow();
  });
  it("does not mistake a body separator for the metadata boundary", () => {
    expect(parseBacklogItem("---\nid: x\ntitle: X\n---\n\n---\n text \n").body).toBe("\n---\n text \n");
  });
  it("uses terminal statuses, not directory names, to decide open state", () => {
    for (const status of ["Done", "COMPLETED", "cancelled", "closed", "canceled"]) expect(isOpenBacklogStatus(status)).toBe(false);
    for (const status of ["To Do", "In Progress", "Blocked"]) expect(isOpenBacklogStatus(status)).toBe(true);
  });
});
