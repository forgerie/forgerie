import { describe, expect, it } from "vitest";
import { pullRequestNumber, pullRequestTarget } from "./pullRequestModel";

describe("pull request link input", () => {
  it.each(["9", "https://github.com/o/r/pull/9", " https://dev.azure.com/o/Amaze%20Insights/_git/r/pullrequest/9?view=files ", "https://o.visualstudio.com/DefaultCollection/p/_git/r/pullrequest/9"])("accepts %s", (value) => { expect(pullRequestNumber(value)).toBe(9); });
  it("keeps the provider and repository identity of pasted URLs", () => {
    expect(pullRequestTarget("https://github.com/o/r/pull/9")).toEqual({ provider: "github", repo: "o/r", number: 9 });
    expect(pullRequestTarget("https://o.visualstudio.com/DefaultCollection/Amaze%20Insights/_git/r/pullrequest/9")).toEqual({ provider: "azure-devops", repo: "o/Amaze Insights/r", number: 9 });
  });
  it.each(["0", "-1", "https://example.test/pullrequest/9", "https://dev.azure.com/o/p/_git/r/pullrequest/0", "https://user:secret@dev.azure.com/o/p/_git/r/pullrequest/9", "not a PR", "999999999999999999999999"])("rejects %s", (value) => { expect(pullRequestNumber(value)).toBeUndefined(); });
});
