import { describe, expect, it } from "vitest";
import { boundSessionCatalogFirstMessage } from "./sessionCatalogMetadata.js";

describe("boundSessionCatalogFirstMessage", () => {
  it("returns a message at the limit unchanged", () => {
    const message = `${"a".repeat(499)}🎉`;

    expect(boundSessionCatalogFirstMessage(message)).toBe(message);
  });

  it("stops reading a large message after the bounded Unicode prefix", () => {
    const message = `${"a".repeat(499)}🎉${"z".repeat(1_000_000)}`;
    const originalIterator = String.prototype[Symbol.iterator];
    let examinedCodePoints = 0;
    Object.defineProperty(String.prototype, Symbol.iterator, {
      configurable: true,
      writable: true,
      value(this: string) {
        const iterator = originalIterator.call(this);
        return {
          next() {
            examinedCodePoints += 1;
            if (examinedCodePoints > 500) throw new Error("read beyond bounded prefix");
            return iterator.next();
          },
          [Symbol.iterator]() {
            return this;
          },
        };
      },
    });

    let bounded: string;
    try {
      bounded = boundSessionCatalogFirstMessage(message);
    } finally {
      Object.defineProperty(String.prototype, Symbol.iterator, {
        configurable: true,
        writable: true,
        value: originalIterator,
      });
    }

    expect(bounded).toBe(`${"a".repeat(499)}🎉`);
    expect(examinedCodePoints).toBeLessThanOrEqual(500);
  });
});
