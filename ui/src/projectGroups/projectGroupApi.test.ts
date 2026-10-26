import { expect, it } from "vitest";
import { createProjectGroupApi } from "./projectGroupApi";

it("requests project directories with the typed path and caller cancellation, and validates completions", async () => {
  const controller = new AbortController();
  let signal: AbortSignal | null | undefined;
  let url = "";
  const api = createProjectGroupApi(async (path, init) => {
    url = path; signal = init?.signal;
    return Response.json([{ path: "/code/a folder/", kind: "other" }]);
  });
  expect(await api.directories("~/code/a folder", controller.signal)).toEqual(["/code/a folder/"]);
  expect(url).toBe(`/api/project-directories?${new URLSearchParams({ q: "~/code/a folder" })}`);
  controller.abort();
  expect(signal?.aborted).toBe(true);
});

it("keeps a directory lookup failure separate from project registration", async () => {
  const api = createProjectGroupApi(async () => Response.json({ error: "Cannot read folders" }, { status: 400 }));
  await expect(api.directories("/code/", new AbortController().signal)).rejects.toThrow("Cannot read folders");
  const invalid = createProjectGroupApi(async () => Response.json([{ path: 3 }]));
  await expect(invalid.directories("/code/", new AbortController().signal)).rejects.toThrow();
});
