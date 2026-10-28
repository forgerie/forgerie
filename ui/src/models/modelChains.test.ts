import { describe, expect, it } from "vitest";
import { chainUsers, entryOf, entryParts, listWords, moveItem, nameProblem, renameChain, withChain, withoutChain } from "./modelChains";

describe("model chain edits", () => {
  const chains = { worker: ["a/one:high", "b/two"], fast: ["c/three"] };
  it("keeps every chain in its place in the file", () => {
    expect(Object.keys(withChain(chains, "worker", ["b/two"]))).toEqual(["worker", "fast"]);
    expect(withChain(chains, "new", ["a/one"])).toEqual({ ...chains, new: ["a/one"] });
    expect(Object.keys(renameChain(chains, "worker", "builder"))).toEqual(["builder", "fast"]);
    expect(withoutChain(chains, "worker")).toEqual({ fast: ["c/three"] });
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });
  it("splits an entry's level from a model id that holds a colon", () => {
    expect(entryParts("local/qwen:32b:high")).toEqual({ key: "local/qwen:32b", level: "high" });
    expect(entryParts("local/qwen:32b")).toEqual({ key: "local/qwen:32b", level: undefined });
    expect(entryOf("local/qwen:32b", undefined)).toBe("local/qwen:32b");
  });
  it("refuses a name that breaks the rule or is taken", () => {
    expect(nameProblem("worker", ["worker"])).toBe("There is already a chain named worker.");
    expect(nameProblem("Worker", [])).toBe("Use lower-case letters, digits and hyphens, and start with a letter or digit.");
    expect(nameProblem("worker-2", ["worker"])).toBeUndefined();
  });
  it("finds the agents that name a chain, with or without a level, each once", () => {
    const agents = [{ name: "A", model: "worker:high" }, { name: "B", model: "a/worker" }, { name: "A", model: "worker" }, { name: "C" }];
    expect(chainUsers(agents, "worker")).toEqual(["A"]);
    expect(listWords(["A", "B", "C"])).toBe("A, B and C");
    expect(listWords(["A"])).toBe("A");
  });
});
