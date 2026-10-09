import { describe, expect, it } from "vitest";
import { createFilesSource } from "./filesSource";

/** A workspace server over a map of files, answering the routes the source uses as the real one does. */
function server(files: Record<string, string>) {
  const calls: { path: string; method: string; body?: string }[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const version = (text: string) => `v:${text}`;
  const request = async (path: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    const body = init.body instanceof Uint8Array ? new TextDecoder("utf-8", { ignoreBOM: true }).decode(init.body) : undefined;
    calls.push({ path, method, ...body === undefined ? {} : { body } });
    const url = new URL(path, "http://forgerie");
    const file = url.searchParams.get("path") ?? "";
    if (url.pathname === "/api/projects") return json([{ id: "p", path: "/repo" }]);
    if (url.pathname === "/api/projects/p/workspaces") return json([{ id: "w", projectId: "p", path: "/repo" }]);
    if (url.pathname === "/api/projects/p/workspaces/w/tree") return json({ path: file, scannedAt: "", truncated: false, entries: [
      { name: ".git", path: ".git", type: "directory" }, { name: "src", path: "src", type: "directory" }, { name: "a.md", path: "a.md", type: "file" }, { name: "l", path: "l", type: "symlink" },
    ] });
    if (url.pathname === "/api/projects/p/workspaces/w/file" && method === "GET") {
      if (file === "logo.png") return json({ path: file, content: "", size: 40, truncated: false, binary: true, encoding: "utf8", modifiedAt: "" });
      const content = files[file];
      if (content === undefined) return json({ error: "Path does not exist" }, 400);
      return json({ path: file, content, size: content.length, truncated: false, binary: false, encoding: "utf8", modifiedAt: "", version: version(content) });
    }
    if (url.pathname === "/api/projects/p/workspaces/w/file" && method === "PUT") {
      const expected = url.searchParams.get("expectedVersion");
      const current = files[file];
      if (expected !== null && (current === undefined || version(current) !== expected)) {
        return json({ error: "changed", code: "conflict", ...current === undefined ? {} : { version: version(current) } }, 409);
      }
      if (url.searchParams.get("overwrite") === "false" && current !== undefined) return json({ error: `File already exists: ${file}` }, 400);
      files[file] = body ?? "";
      return json({ path: file, size: 0, modifiedAt: "", created: current === undefined, version: version(body ?? "") });
    }
    return json({ error: "Unexpected" }, 404);
  };
  return { calls, request, files };
}

describe("files source", () => {
  const signal = new AbortController().signal;

  it("lists a folder without git's own folder, and marks links", async () => {
    const { request } = server({});
    expect(await createFilesSource("/repo", request).folder("", signal)).toEqual({ truncated: false, entries: [
      { name: "src", path: "src", type: "folder" }, { name: "a.md", path: "a.md", type: "file" }, { name: "l", path: "l", type: "link" },
    ] });
  });

  it("opens text with its version, and a file it cannot save back as locked", async () => {
    const source = createFilesSource("/repo", server({ "a.md": "# A\n" }).request);
    expect(await source.read("a.md", signal)).toEqual({ type: "text", path: "a.md", text: "# A\n", version: "v:# A\n" });
    expect(await source.read("logo.png", signal)).toEqual({ type: "locked", path: "logo.png", reason: "binary", size: 40 });
  });

  it("saves the exact bytes against the version read, and reports a change on disk as a conflict", async () => {
    const { request, files, calls } = server({ "a.md": "old" });
    const source = createFilesSource("/repo", request);
    expect(await source.write("a.md", "\uFEFFnew", { type: "version", version: "v:old" }, signal)).toEqual({ type: "saved", version: "v:\uFEFFnew" });
    expect(files["a.md"]).toBe("\uFEFFnew");
    expect(await source.write("a.md", "mine", { type: "version", version: "v:old" }, signal)).toEqual({ type: "conflict", version: "v:\uFEFFnew" });
    expect(calls.at(-1)?.path).toBe("/api/projects/p/workspaces/w/file?path=a.md&createDirs=false&expectedVersion=v%3Aold");
  });

  it("brings back a deleted file only while it is still gone", async () => {
    const { request, files } = server({});
    const source = createFilesSource("/repo", request);
    expect(await source.write("gone.md", "mine", { type: "version", version: "v:x" }, signal)).toEqual({ type: "conflict", version: undefined });
    expect(await source.write("gone.md", "mine", { type: "absent" }, signal)).toMatchObject({ type: "saved" });
    await expect(source.write("gone.md", "again", { type: "absent" }, signal)).rejects.toThrow("File already exists: gone.md");
    expect(files["gone.md"]).toBe("mine");
  });
});
