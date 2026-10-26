import type { PathSuggest } from "../PathField";

const folders = ["/code/", "/code/coach/", "/code/forgerie/", "/code/forgerie/ui/", "/code/forgerie/src/",
  "/code/korri/", "/code/repositories-with-a-long-unbroken-name-that-still-needs-to-be-readable/",
  ...Array.from({ length: 80 }, (_, index) => `/many/repository-${String(index + 1).padStart(2, "0")}/`)];

/** The same directory edge as production, with a fixed tree and no network. */
export const suggestFolders: PathSuggest = async (query) => {
  const parent = query.slice(0, query.lastIndexOf("/") + 1);
  return folders.filter((path) => path !== parent && path.startsWith(query) && path.slice(parent.length).indexOf("/") === path.slice(parent.length).length - 1);
};
export const unavailableFolders: PathSuggest = async () => { throw new Error("Cannot read folders. Check the server connection and try again."); };
export const pendingFolders: PathSuggest = () => new Promise(() => undefined);
