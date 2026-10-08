import { describe, expect, it } from "vitest";
import { durableJson } from "./durableJson.js";

describe("Durable JSON conversion", () => {
  it("omits undefined object fields and preserves nested JSON values", () => {
    expect(durableJson({ missing: undefined, nested: { count: 2, enabled: true, value: null } })).toEqual({ nested: { count: 2, enabled: true, value: null } });
  });
  it("fills undefined array elements and sparse slots with null", () => {
    const array: unknown[] = [undefined, "value"];
    array.length = 3;
    expect(durableJson(array)).toEqual([null, "value", null]);
  });
  it("uses ISO dates and rejects invalid dates", () => {
    expect(durableJson(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01T00:00:00.000Z");
    expect(() => durableJson(new Date("invalid"))).toThrow("invalid date");
  });
  it("rejects unsupported values instead of silently dropping their data", () => {
    for (const value of [NaN, Infinity, 1n, Symbol("value"), () => 1, new Map([["key", "value"]]), new Set([1])]) {
      expect(() => durableJson(value)).toThrow(TypeError);
    }
  });
  it("rejects cycles but permits repeated non-cyclic references", () => {
    const shared = { value: 1 };
    expect(durableJson([shared, shared])).toEqual([{ value: 1 }, { value: 1 }]);
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(() => durableJson(cyclic)).toThrow("cycle");
  });
  it("keeps __proto__ keys as ordinary JSON data", () => {
    const input = Object.fromEntries([["__proto__", { value: "data" }]]);
    const converted = durableJson(input);
    if (typeof converted !== "object" || converted === null) throw new Error("Converted object must remain an object");
    expect(converted).toEqual(input);
    expect(Object.getPrototypeOf(converted)).toBe(Object.prototype);
    expect(Object.hasOwn(converted, "__proto__")).toBe(true);
  });
});
