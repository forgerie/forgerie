import type { TemplateResult } from "lit";
import { describe, expect, it } from "vitest";
import type { ChatLine } from "./shared";
import {
  ChatView,
  chatImagePartSource,
  chatMessageAnchorKey,
  chatToolOutputLabel,
} from "./ChatView";
import { templateEventHandlerAfterMarker } from "../templateInspection.testSupport";

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

describe("ChatView image event wiring", () => {
  // Escape hatch: this case verifies the image `@load` re-pin wiring, whose
  // only observable effect is a private scroll side effect. The full-screen
  // click path is covered through real shadow DOM in ChatView.imageModal.test.
  it("delegates late image loads to the unified follow target", () => {
    const view = new ChatView();
    let placements = 0;
    if (!Reflect.set(view, "scheduleCurrentFollowTarget", () => { placements += 1; })) throw new Error("Could not observe ChatView.scheduleCurrentFollowTarget");
    const rendered = renderPart(view, { type: "image", mimeType: "image/png", data: "QUJD" });
    const onLoad = templateEventHandlerAfterMarker(rendered, "@load=");

    onLoad(new Event("load"));

    expect(placements).toBe(1);
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
