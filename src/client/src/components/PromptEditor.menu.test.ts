import type { TemplateResult } from "lit";
import { describe, expect, it, vi } from "vitest";
import { isTemplateResult, templateClickHandlerForText, templateText } from "../templateInspection.testSupport";
import { PromptEditor } from "./PromptEditor";

describe("PromptEditor island menu", () => {
  it("offers one way to attachments and the session controls", () => {
    const composer = new PromptEditor();
    const onOpenControlSheet = vi.fn();
    composer.onOpenControlSheet = onOpenControlSheet;

    const rendered = render(composer);
    expect(templateText(rendered)).toContain("Attachments and session controls");
    templateClickHandlerForText(rendered, "Attachments and session controls")(new Event("click"));

    expect(onOpenControlSheet).toHaveBeenCalledOnce();
  });

  it("says how much is waiting behind it, because nothing else reports that now", () => {
    const composer = new PromptEditor();
    composer.attentionCount = 3;

    expect(templateText(render(composer))).toContain("Attachments and session controls, 3 waiting");
  });

  it("opens the file picker for the sheet, which cannot reach the input itself", () => {
    const composer = new PromptEditor();
    const click = vi.fn();
    seedAttachmentInput(composer, click);

    composer.openAttachmentPicker();

    expect(click).toHaveBeenCalledOnce();
  });

  it("refuses to start an attachment on a session that cannot take one", () => {
    const composer = new PromptEditor();
    const click = vi.fn();
    seedAttachmentInput(composer, click);
    composer.disabled = true;

    composer.openAttachmentPicker();

    expect(click).not.toHaveBeenCalled();
  });
});

function seedAttachmentInput(composer: PromptEditor, click: () => void): void {
  Object.defineProperty(composer, "attachmentInput", { configurable: true, value: { click } });
}

function render(composer: PromptEditor): TemplateResult {
  const rendered: unknown = composer.render();
  if (!isTemplateResult(rendered)) throw new Error("expected the composer template");
  return rendered;
}
