import type { JsonValue } from "@earendil-works/chord";

/** SDK results contain optional undefined fields. Durable documents require strict JSON. */
export function durableJson(value: unknown): JsonValue {
  return convert(value, new WeakSet());
}

function convert(value: unknown, ancestors: WeakSet<object>): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new TypeError("Durable state cannot contain an invalid date");
    return value.toISOString();
  }
  if (typeof value !== "object") throw new TypeError(`Durable state cannot contain ${typeof value}`);
  if (ancestors.has(value)) throw new TypeError("Durable state cannot contain a cycle");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return Array.from(value, (item: unknown) => item === undefined ? null : convert(item, ancestors));
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Durable state requires a plain JSON object");
    const entries: [string, JsonValue][] = [];
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) entries.push([key, convert(item, ancestors)]);
    }
    // fromEntries keeps __proto__ as data rather than changing the result's prototype.
    return Object.fromEntries(entries);
  } finally { ancestors.delete(value); }
}
