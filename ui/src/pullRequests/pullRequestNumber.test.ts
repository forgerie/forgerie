import { describe, expect, it } from "vitest";
import { pullRequestNumber } from "./pullRequestModel";

describe("pull request link input", () => {
  it.each(["9", " https://dev.azure.com/o/Amaze%20Insights/_git/r/pullrequest/9?view=files ", "https://o.visualstudio.com/DefaultCollection/p/_git/r/pullrequest/9"])("accepts %s", (value) => { expect(pullRequestNumber(value)).toBe(9); });
  it.each(["0", "-1", "https://example.test/pullrequest/9", "https://dev.azure.com/o/p/_git/r/pullrequest/0", "https://user:secret@dev.azure.com/o/p/_git/r/pullrequest/9", "not a PR", "999999999999999999999999"])("rejects %s", (value) => { expect(pullRequestNumber(value)).toBeUndefined(); });
});
