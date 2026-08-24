import type { TemplateResult } from "lit";
import { describe, expect, it } from "vitest";
import { chatStyles, type ChatLine } from "./shared";
import {
  ChatView,
  chatImagePartSource,
  chatMessageAnchorKey,
  chatToolOutputLabel,
} from "./ChatView";
import { findOptionalTemplateEventHandlerNearMarker } from "../templateInspection.testSupport";

describe("ChatView image content derivation", () => {
  // Content/attribute derivation (image src/alt, the tool-output header label,
  // and the scroll-anchor key) lives in pure exported seams rather than being
  // scraped from rendered `TemplateResult` markup, per the testing-guide rule
  // that TemplateResult inspection is not for general content assertions.
  it("derives the image data URL and alt text from an image part", () => {
    expect(chatImagePartSource({ type: "image", mimeType: "image/png", data: "QUJD" })).toEqual({
      src: "data:image/png;base64,QUJD",
      alt: "attached image",
    });
  });

  it("labels tool image output by tool name and falls back to a generic label", () => {
    expect(chatToolOutputLabel("read")).toBe("read output");
    expect(chatToolOutputLabel(undefined)).toBe("tool output");
    expect(chatToolOutputLabel("")).toBe("tool output");
  });

  it("keys a tool image message to its stable scroll anchor", () => {
    expect(chatMessageAnchorKey(7)).toBe("m:7");
  });
});

describe("inline transcript image", () => {
  // A late image decode used to grow the transcript and then trigger a re-pin,
  // which moved the reader's position. The band removes the growth, so the
  // re-pin has nothing to correct and must not exist.
  it("reserves a fixed band height, so a late decode cannot move the reading position", () => {
    expect(chatStyles.cssText).toMatch(/\.chat-image\s*{[^}]*block-size:\s*clamp\(/);
    expect(chatStyles.cssText).not.toMatch(/\.chat-image\s*{[^}]*max-height:/);
  });

  it("contains the image inside the band instead of cropping it", () => {
    expect(chatStyles.cssText).toMatch(/\.chat-image\s*{[^}]*object-fit:\s*contain/);
  });

  // Escape hatch: absence of event wiring is only observable on the template.
  it("wires no load handler, so image decodes never re-pin the transcript", () => {
    const rendered = renderPart(new ChatView(), { type: "image", mimeType: "image/png", data: "QUJD" });

    expect(findOptionalTemplateEventHandlerNearMarker(rendered, "@load=")).toBeUndefined();
  });
});

type RenderPart = (this: ChatView, part: ChatLine["parts"][number], message?: ChatLine) => TemplateResult;

function renderPart(view: ChatView, part: ChatLine["parts"][number], message?: ChatLine): TemplateResult {
  const method: unknown = Reflect.get(view, "renderPart");
  if (!isRenderPart(method)) throw new Error("ChatView.renderPart is not callable");
  return method.call(view, part, message);
}

function isRenderPart(value: unknown): value is RenderPart {
  return typeof value === "function";
}
