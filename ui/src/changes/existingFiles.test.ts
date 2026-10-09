import { describe, expect, it, vi } from "vitest";
import { existingFiles, LISTING_LIFETIME_MS } from "./existingFiles";
import { workspacePath } from "./workspacePath";
import type { Folder } from "../ui/lazyTree";

const DISK: Record<string, Folder> = {
  "": { entries: [{ name: "src", path: "src", type: "folder" }, { name: "README.md", path: "README.md", type: "file" }], truncated: false },
  src: { entries: [{ name: "a.ts", path: "src/a.ts", type: "file" }, { name: "b.ts", path: "src/b.ts", type: "link" }], truncated: false },
};
function source() {
  const folder = vi.fn(async (path: string) => {
    const listing = DISK[path];
    if (!listing) throw new Error("Path does not exist");
    return listing;
  });
  return { folder };
}
const signal = () => new AbortController().signal;

describe("existingFiles", () => {
  it("keeps only the paths whose folder lists them as a file or a link", async () => {
    const existing = existingFiles(source(), (path) => path);
    expect(await existing(["src/a.ts", "src/b.ts", "src/gone.ts", "README.md", "src", "lib/x.ts"], signal()))
      .toEqual(new Set(["src/a.ts", "src/b.ts", "README.md"]));
  });

  it("answers in the reply's own words after mapping into the workspace", async () => {
    const existing = existingFiles(source(), (path) => workspacePath("/w", path));
    expect(await existing(["w/src/a.ts", "/elsewhere/a.ts"], signal())).toEqual(new Set(["w/src/a.ts"]));
  });

  it("refuses a path that climbs out of the workspace", async () => {
    const files = source();
    expect(await existingFiles(files, (path) => path)(["src/../README.md"], signal())).toEqual(new Set());
    expect(files.folder).not.toHaveBeenCalled();
  });

  it("lists each folder once while the listing is fresh, and again after", async () => {
    let time = 0;
    const files = source();
    const existing = existingFiles(files, (path) => path, () => time);
    await Promise.all([existing(["src/a.ts", "src/b.ts"], signal()), existing(["src/a.ts"], signal())]);
    expect(files.folder).toHaveBeenCalledTimes(1);
    time = LISTING_LIFETIME_MS;
    await existing(["src/a.ts"], signal());
    expect(files.folder).toHaveBeenCalledTimes(2);
  });

  it("rejects once its caller has aborted", async () => {
    const controller = new AbortController();
    const pending = existingFiles(source(), (path) => path)(["src/a.ts"], controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});
