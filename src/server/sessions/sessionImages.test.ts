import { describe, expect, it } from "vitest";
import { findSessionImage, sessionImageUrl, withImageReferences } from "./sessionImages";

const ref = { id: "s/1", cwd: "/repo" };
const png = { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" };
const gif = { type: "image", data: "R0lGOD", mimeType: "image/gif" };

describe("session image references", () => {
  it("replaces inline bytes with a URL that names the message and the image position", () => {
    const messages = [{ id: "m1", role: "toolResult", content: [{ type: "text", text: "read" }, png, gif] }];
    const [message] = withImageReferences(ref, messages);
    expect(message?.content).toEqual([
      { type: "text", text: "read" },
      { type: "image", mimeType: "image/png", url: sessionImageUrl(ref, "m1", 0) },
      { type: "image", mimeType: "image/gif", url: sessionImageUrl(ref, "m1", 1) },
    ]);
    expect(sessionImageUrl(ref, "m1", 1)).toBe("/api/sessions/s%2F1/images?cwd=%2Frepo&message=m1&image=1");
    expect(messages[0]?.content[1]).toBe(png);
  });

  it("keeps bytes on messages without an ID and keeps messages without images identical", () => {
    const anonymous = { role: "toolResult", content: [png] };
    const text = { id: "m2", role: "assistant", content: [{ type: "text", text: "hi" }] };
    const result = withImageReferences(ref, [anonymous, text]);
    expect(result[0]).toBe(anonymous);
    expect(result[1]).toBe(text);
  });

  it("resolves a reference back to the bytes it replaced", () => {
    const messages = [{ id: "m1", content: [{ type: "text", text: "x" }, png, gif] }];
    expect(findSessionImage(messages, "m1", 1)).toEqual({ mimeType: "image/gif", data: "R0lGOD" });
    expect(findSessionImage(messages, "m1", 2)).toBeUndefined();
    expect(findSessionImage(messages, "missing", 0)).toBeUndefined();
  });

  it("never resolves a type that a browser could run as a page", () => {
    const messages = [{ id: "m1", content: [{ type: "image", data: "PGh0bWw+", mimeType: "text/html" }] }];
    expect(findSessionImage(messages, "m1", 0)).toBeUndefined();
  });
});
