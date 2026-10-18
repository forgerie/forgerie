import { expect, it } from "vitest";
import { parsePushFolders, readWorkflowAutonomy, WAIT_FOR_USER } from "./workflowAutonomy.js";

it("lands automatically and allows two review rounds by default, and waits for the user when the plugin is off", () => {
  expect(readWorkflowAutonomy({})).toEqual({ landStops: true, approveStops: false, reviewRounds: 2, pushDefaultFolders: [] });
  expect(readWorkflowAutonomy({ plugins: { "workflow-autonomy": { enabled: false } } })).toEqual(WAIT_FOR_USER);
  expect(readWorkflowAutonomy({ plugins: { "workflow-autonomy": { settings: { approve_stops: true, land_stops: false, review_rounds: "unlimited" } } } }))
    .toEqual({ landStops: false, approveStops: true, reviewRounds: undefined, pushDefaultFolders: [] });
  // An invalid stored value falls back to the default.
  expect(readWorkflowAutonomy({ plugins: { "workflow-autonomy": { settings: { review_rounds: "9" } } } }).reviewRounds).toBe(2);
});

it("reads the folders that may push to their default branch, and drops none, relative paths and the root", () => {
  expect(parsePushFolders("~/code/sandbox, /srv/repos/\nnone, relative/path, /, ~", "/home/me")).toEqual(["/home/me/code/sandbox", "/srv/repos", "/home/me"]);
  expect(parsePushFolders("none")).toEqual([]);
  expect(readWorkflowAutonomy({ plugins: { "workflow-autonomy": { settings: { push_default_folders: "/srv/a,/srv/b" } } } }).pushDefaultFolders).toEqual(["/srv/a", "/srv/b"]);
  // Turning the plugin off asks for every push again.
  expect(readWorkflowAutonomy({ plugins: { "workflow-autonomy": { enabled: false, settings: { push_default_folders: "/srv/a" } } } }).pushDefaultFolders).toEqual([]);
});
