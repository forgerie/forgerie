import { describe, expect, it } from "vitest";
import { normalizeMessage } from "../client/src/chatMessages.js";
import type { MessagePage } from "../shared/apiTypes.js";
import { projectBrowserMessage, projectBrowserMessagePreviewResponse, projectBrowserMessageResponse, projectBrowserSessionEvent } from "./browserMessageProjection.js";

function signedAssistantMessage() {
  return {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "private chain", thinkingSignature: "opaque-provider-payload", redacted: true },
      { type: "text", text: "visible answer", textSignature: "text-metadata" },
      { type: "toolCall", name: "read", arguments: { thinkingSignature: "ordinary nested argument" }, thoughtSignature: "tool-metadata" },
    ],
    model: "model-1",
  };
}

describe("browser message projection", () => {
  it("omits only thinking-block signatures without mutating runtime messages", () => {
    const message = signedAssistantMessage();

    const projected = projectBrowserMessage(message);

    expect(projected).toEqual({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "private chain", redacted: true },
        { type: "text", text: "visible answer", textSignature: "text-metadata" },
        { type: "toolCall", name: "read", arguments: { thinkingSignature: "ordinary nested argument" }, thoughtSignature: "tool-metadata" },
      ],
      model: "model-1",
    });
    expect(message.content[0]).toEqual({ type: "thinking", thinking: "private chain", thinkingSignature: "opaque-provider-payload", redacted: true });
    expect(normalizeMessage(projected)).toEqual(normalizeMessage(message));
  });

  it("projects paged history responses", () => {
    const message = signedAssistantMessage();
    const page: MessagePage = { messages: [message], start: 4, total: 5 };

    expect(projectBrowserMessageResponse(page)).toEqual({
      messages: [{ ...message, content: [{ type: "thinking", thinking: "private chain", redacted: true }, ...message.content.slice(1)] }],
      start: 4,
      total: 5,
    });
    expect(page.messages[0]).toBe(message);
  });

  it("bounds heavy preview content without changing message positions or the source page", () => {
    const huge = "x".repeat(100_000);
    const page: MessagePage = {
      messages: [
        { role: "user", content: [{ type: "text", text: huge }] },
        { role: "assistant", content: [{ type: "thinking", thinking: huge }, { type: "toolCall", id: "tool-1", name: "read", arguments: { path: huge } }] },
        { role: "toolResult", content: [{ type: "text", text: huge }, { type: "image", mimeType: "image/png", data: huge }] },
        { role: "custom", content: huge, details: { transcript: huge } },
      ],
      start: 39,
      total: 43,
    };

    const preview = projectBrowserMessagePreviewResponse(page);
    const encoded = JSON.stringify(preview);

    expect(preview.start).toBe(39);
    expect(preview.total).toBe(43);
    expect(preview.messages).toHaveLength(4);
    expect(encoded.length).toBeLessThan(40_000);
    expect(encoded).toContain("Preview truncated; full content is loading");
    expect(encoded).not.toContain('"data"');
    expect(page.messages[0]).toEqual({ role: "user", content: [{ type: "text", text: huge }] });
  });

  it("bounds unknown content blocks and nested plugin payloads", () => {
    const huge = "plugin-data".repeat(20_000);
    const content = [
      { type: "text", text: "readable answer" },
      ...Array.from({ length: 100 }, (_, index) => ({ type: `plugin-${String(index)}`, payload: { nested: [huge, { huge }] } })),
    ];

    const preview = projectBrowserMessagePreviewResponse({ messages: [{ role: "assistant", content }], start: 0, total: 1 });
    const encoded = JSON.stringify(preview);

    expect(encoded.length).toBeLessThan(20_000);
    expect(encoded).toContain("Preview omitted; full content is loading");
    expect(encoded).not.toContain(huge);
  });

  it("bounds record-shaped content and drops arbitrary top-level payloads", () => {
    const huge = "metadata".repeat(50_000);
    const preview = projectBrowserMessagePreviewResponse({
      messages: [{ role: "assistant", content: { pluginPayload: huge }, topLevelUnknown: { huge }, details: { diagnostic: huge } }],
      start: 0,
      total: 1,
    });
    const encoded = JSON.stringify(preview);

    expect(encoded.length).toBeLessThan(20_000);
    expect(encoded).not.toContain(huge);
    expect(encoded).not.toContain("topLevelUnknown");
  });

  it("never exposes thinking signatures through preview variants", () => {
    const page: MessagePage = {
      messages: [{ role: "assistant", content: [{ type: "thinking", text: "fallback", thinkingSignature: "private" }] }],
      start: 0,
      total: 1,
    };

    expect(JSON.stringify(projectBrowserMessagePreviewResponse(page))).not.toContain("thinkingSignature");
  });

  it("keeps raw paging positions while bounding preview normalization work", () => {
    const messages = Array.from({ length: 300 }, (_, index) => ({ role: "toolResult", content: [{ type: "text", text: `tool ${String(index)}` }] }));
    messages.splice(150, 0, { role: "user", content: [{ type: "text", text: "older question" }] });
    messages.push({ role: "assistant", content: [{ type: "text", text: "latest answer" }] });

    const preview = projectBrowserMessagePreviewResponse({ messages, start: 50, total: 352 });
    const normalized = preview.messages.flatMap(normalizeMessage);

    expect(preview.start).toBe(152);
    expect(preview.messages).toHaveLength(200);
    expect(normalized).toHaveLength(3);
    expect(JSON.stringify(normalized)).toContain("older question");
    expect(JSON.stringify(normalized)).toContain("latest answer");
    expect(JSON.stringify(normalized)).toContain("tool 299");
    expect(JSON.stringify(normalized)).not.toContain("tool 0");
  });

  it("projects final-message events but leaves other event shapes untouched", () => {
    const message = signedAssistantMessage();
    const finalEvent = { type: "message.end" as const, message };
    const appendEvent = { type: "message.append" as const, message };

    expect(projectBrowserSessionEvent(finalEvent)).toEqual({
      type: "message.end",
      message: { ...message, content: [{ type: "thinking", thinking: "private chain", redacted: true }, ...message.content.slice(1)] },
    });
    expect(projectBrowserSessionEvent(appendEvent)).toBe(appendEvent);
    expect(finalEvent.message).toBe(message);
  });
});
