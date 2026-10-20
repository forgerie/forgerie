import { describe, expect, it } from "vitest";
import { cwdPathsEqual } from "../workingDirectory.js";
import { groupByCwd } from "./cwdGroups.js";

function random(seed: number) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
}
const paths: [string, ...string[]] = ["/a", "/a/", "/a/./", "/a/b", "/a/b/..", "/b", "/b//", "/", "relative", "relative/"];

describe("groupByCwd", () => {
  it("returns, for any cwd, exactly the items a cwdPathsEqual filter returns, in the same order", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const next = random(seed);
      const pick = () => paths[Math.floor(next() * paths.length)] ?? paths[0];
      const items = Array.from({ length: Math.floor(next() * 30) }, (_, index) => ({ index, cwd: pick() }));
      const groups = groupByCwd(items, (item) => item.cwd);
      for (const cwd of paths) {
        expect(groups.get(cwd), `seed ${String(seed)} cwd ${cwd}`).toEqual(items.filter((item) => cwdPathsEqual(item.cwd, cwd)));
      }
    }
  });
});
