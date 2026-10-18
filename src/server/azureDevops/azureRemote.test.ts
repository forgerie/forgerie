import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { originAzureRepo, parseAzureRemote } from "./azureRemote.js";

describe("Azure origins", () => {
  it.each([
    "https://dev.azure.com/amazeinsights/Amaze%20Insights/_git/portal-source",
    "https://user@dev.azure.com/amazeinsights/Amaze%20Insights/_git/portal-source",
    "https://amazeinsights.visualstudio.com/Amaze%20Insights/_git/portal-source",
    "https://amazeinsights.visualstudio.com/DefaultCollection/Amaze%20Insights/_git/portal-source",
    "git@ssh.dev.azure.com:v3/amazeinsights/Amaze%20Insights/portal-source",
    "amazeinsights@vs-ssh.visualstudio.com:v3/amazeinsights/Amaze%20Insights/portal-source",
  ])("decodes %s", (remote) => {
    expect(parseAzureRemote(remote)).toEqual({ organization: "amazeinsights", project: "Amaze Insights", repository: "portal-source" });
  });
  it("decodes the organization and repository as well as the project", () => {
    expect(parseAzureRemote("https://dev.azure.com/%61mazeinsights/Amaze%20Insights/_git/portal%20source")).toEqual({ organization: "amazeinsights", project: "Amaze Insights", repository: "portal source" });
  });
  it.each(["https://github.com/o/r", "https://evil.dev.azure.com/o/p/_git/r", "https://dev.azure.com/o/p/_git/r/extra", "git@ssh.dev.azure.com:v3/o/%ZZ/r", "https://dev.azure.com/o/p/_git/%2F", "http://dev.azure.com/o/p/_git/r"])("rejects %s", (remote) => {
    expect(parseAzureRemote(remote)).toBeUndefined();
  });
  it("reports a folder that is not a git checkout as no repo", async () => {
    const folder = await mkdtemp(join(tmpdir(), "forgerie-azure-remote-"));
    try { expect(await originAzureRepo(folder)).toBeUndefined(); } finally { await rm(folder, { recursive: true, force: true }); }
  });
});
