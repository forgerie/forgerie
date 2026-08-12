import { describe, expect, it } from "vitest";
import { composerBranchIdentity } from "./composerIdentity";

/**
 * The rail states what is unusual, not what is true. Being on a project's main
 * worktree is the expected case, so it is stated by saying nothing.
 */
describe("composerBranchIdentity", () => {
  it("says nothing on the main worktree", () => {
    expect(composerBranchIdentity({ label: "main", branch: "main", isMain: true })).toBeUndefined();
    expect(composerBranchIdentity({ label: "main", isMain: true })).toBeUndefined();
  });

  it("drops a prefix that only states a category", () => {
    expect(composerBranchIdentity({ label: "feat/composer-live-dictation", isMain: false }))
      .toEqual({ name: "composer-live-dictation", title: "feat/composer-live-dictation" });
    expect(composerBranchIdentity({ label: "refactor/nix-on-rock-storage-contract", isMain: false })?.name)
      .toBe("nix-on-rock-storage-contract");
  });

  it("keeps the whole name in the title, however it is shortened", () => {
    const identity = composerBranchIdentity({ label: "fix/steam-appid-exclusive-gamescope-lifecycle", isMain: false });

    expect(identity?.title).toBe("fix/steam-appid-exclusive-gamescope-lifecycle");
    expect(identity?.name).toBe("steam-appid-exclusive-gamescope-lifecycle");
  });

  it("keeps a name that carries no prefix", () => {
    expect(composerBranchIdentity({ label: "instant-chat-u3-rebased", isMain: false })?.name).toBe("instant-chat-u3-rebased");
  });

  it("prefers the branch when a label and a branch disagree", () => {
    expect(composerBranchIdentity({ label: "worktree-3", branch: "feat/odin2portal-rollback-bundle", isMain: false }))
      .toEqual({ name: "odin2portal-rollback-bundle", title: "feat/odin2portal-rollback-bundle" });
  });

  it("says nothing when there is no workspace to name", () => {
    expect(composerBranchIdentity(undefined)).toBeUndefined();
    expect(composerBranchIdentity({ label: "", isMain: false })).toBeUndefined();
  });
});
