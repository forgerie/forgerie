import { describe, expect, it } from "vitest";
import {
  DEFAULT_INBOX_DENSITY,
  INBOX_DENSITY_STORAGE_KEY,
  inboxRowShape,
  initialInboxDensity,
  parseInboxDensity,
  readInboxDensityPreference,
  writeInboxDensityPreference,
} from "./inboxDensity";

describe("inbox density", () => {
  it("defaults to dense", () => {
    expect(DEFAULT_INBOX_DENSITY).toBe("dense");
    expect(initialInboxDensity(new InMemoryStorage())).toBe("dense");
  });

  it("gives an ordinary dense row one line", () => {
    expect(inboxRowShape("dense", false)).toBe("one-line");
  });

  it("gives a dense row with a detail its second line back", () => {
    // Blocked, errored, and working are the only states that carry a detail,
    // and that detail is the reason to read the row.
    expect(inboxRowShape("dense", true)).toBe("two-line");
  });

  it("gives every comfortable row two lines, detail or not", () => {
    expect(inboxRowShape("comfortable", false)).toBe("two-line");
    expect(inboxRowShape("comfortable", true)).toBe("two-line");
  });

  it("parses stored values and rejects anything else", () => {
    expect(parseInboxDensity("dense")).toBe("dense");
    expect(parseInboxDensity("comfortable")).toBe("comfortable");
    expect(parseInboxDensity(null)).toBeUndefined();
    expect(parseInboxDensity("compact")).toBeUndefined();
  });

  it("reads and writes the stored choice", () => {
    const storage = new InMemoryStorage();

    expect(readInboxDensityPreference(storage)).toBeUndefined();
    writeInboxDensityPreference("comfortable", storage);
    expect(storage.value(INBOX_DENSITY_STORAGE_KEY)).toBe("comfortable");
    expect(readInboxDensityPreference(storage)).toBe("comfortable");
    expect(initialInboxDensity(storage)).toBe("comfortable");

    writeInboxDensityPreference("dense", storage);
    expect(readInboxDensityPreference(storage)).toBe("dense");
  });

  it("falls back to dense when storage refuses", () => {
    const storage = new UnavailableStorage();

    expect(readInboxDensityPreference(storage)).toBeUndefined();
    expect(initialInboxDensity(storage)).toBe("dense");
    expect(() => { writeInboxDensityPreference("comfortable", storage); }).not.toThrow();
  });
});

class InMemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  value(key: string): string | undefined {
    return this.values.get(key);
  }
}

/** A browser that refuses storage, as private-mode browsers do. */
class UnavailableStorage {
  getItem(): string | null {
    throw new Error("storage unavailable");
  }

  setItem(): void {
    throw new Error("storage unavailable");
  }
}
