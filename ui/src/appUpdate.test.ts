import { describe, expect, it } from "vitest";
import { checkBuild, entryName, fetchBuild } from "./appUpdate";

const answering = (status: number, body: unknown): typeof fetch => () => Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("app update check", () => {
  it("names the running build by its entry script's file name", () => {
    expect(entryName("https://forgerie.example/assets/index-DOYOtBDS.js")).toBe("index-DOYOtBDS.js");
  });

  it("offers an update only when the deployed entry differs", () => {
    expect(checkBuild("index-a.js", { entry: "index-a.js" })).toEqual({ type: "current" });
    expect(checkBuild("index-a.js", { entry: "index-b.js" })).toEqual({ type: "available", entry: "index-b.js" });
    expect(checkBuild("index-a.js", { other: true })).toEqual({ type: "unknown" });
  });

  it("treats a failed or refused read as unknown, so a restart never shows a false update", async () => {
    expect(await fetchBuild("index-a.js", answering(200, { entry: "index-b.js" }), "https://forgerie.example/")).toEqual({ type: "available", entry: "index-b.js" });
    expect(await fetchBuild("index-a.js", answering(502, { entry: "index-b.js" }), "https://forgerie.example/")).toEqual({ type: "unknown" });
    expect(await fetchBuild("index-a.js", () => Promise.reject(new TypeError("offline")), "https://forgerie.example/")).toEqual({ type: "unknown" });
  });

  it("reads build.json beside the page, past the HTTP cache", async () => {
    const requests: { url: string; cache: RequestCache | undefined }[] = [];
    const recording: typeof fetch = (input, init) => {
      requests.push({ url: String(input), cache: init?.cache });
      return Promise.resolve(new Response(JSON.stringify({ entry: "index-a.js" })));
    };
    await fetchBuild("index-a.js", recording, "https://forgerie.example/base/?session=1");
    expect(requests).toEqual([{ url: "https://forgerie.example/base/build.json", cache: "no-store" }]);
  });
});
