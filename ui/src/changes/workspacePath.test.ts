import { describe, expect, it } from "vitest";
import { workspacePath } from "./workspacePath";

const cwd = "/home/me/code/app";

describe("workspacePath", () => {
  it("keeps a path from the workspace root", () => {
    expect(workspacePath(cwd, "ui/src/ui/OptionRow.tsx")).toBe("ui/src/ui/OptionRow.tsx");
  });
  it("drops the workspace folder from an absolute path", () => {
    expect(workspacePath(cwd, "/home/me/code/app/src/main.ts")).toBe("src/main.ts");
  });
  it("drops the workspace folder when the leading slash is already gone", () => {
    expect(workspacePath(`${cwd}/`, "home/me/code/app/src/main.ts")).toBe("src/main.ts");
  });
  it("drops a leading ./", () => {
    expect(workspacePath(cwd, "./README.md")).toBe("README.md");
  });
  it("keeps a sibling folder that only starts with the same name", () => {
    expect(workspacePath(cwd, "/home/me/code/app2/x.ts")).toBe("home/me/code/app2/x.ts");
  });
});
