import { transformMessages } from "@earendil-works/pi-ai/api/transform-messages";
import type { Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { AzureDevopsClient } from "./azureDevopsClient.js";
import { azureConfig, patCredentialSource, workItem } from "./azureDevops.testSupport.js";
import { AZURE_IMAGE_BYTES, type AzureWorkItemImageRef } from "./azureWorkItemImages.js";
import { createAzureDevopsBacklogProvider } from "../backlog/azureDevopsBacklog.js";
import type { Project } from "../../shared/apiTypes.js";

const url = "https://dev.azure.com/amazeinsights/project-guid/_apis/wit/attachments/11111111-2222-3333-4444-555555555555?fileName=image.png";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const ref = (source = url, index = 1): AzureWorkItemImageRef => ({ url: source, name: `image-${String(index)}`, index, section: "Description" });
function client(reply: (url: string, init: RequestInit) => Response | Promise<Response> = () => new Response(png)) {
  const calls: { url: string; init: RequestInit }[] = [];
  const credentials = patCredentialSource();
  const reader = new AzureDevopsClient({ credentials, fetch: async (url, init) => { calls.push({ url, init }); return reply(url, init); } });
  return { reader, calls, credentials };
}

const project: Project = { id: "p", name: "Code", path: "/code", createdAt: "now" };

describe("Azure attachment reads through the client", () => {
  it.each([
    "https://evil.invalid/amazeinsights/_apis/wit/attachments/11111111-2222-3333-4444-555555555555",
    url.replace("amazeinsights", "other-org"), url.replace("https:", "http:"),
    url.replace("/_apis/wit/attachments/", "/_apis/git/attachments/"),
    url.replace("555555555555", "not-a-guid"), url.replace("dev.azure.com", "dev.azure.com.evil.invalid"),
    url.replace("dev.azure.com", "user:password@dev.azure.com"), url.replace("dev.azure.com", "dev.azure.com:8443"),
    "file:///etc/passwd", "//dev.azure.com/amazeinsights/image.png",
  ])("never fetches or reads credentials for a rejected source: %s", async (source) => {
    const f = client(); let credentialsRead = 0;
    f.credentials.read = () => { credentialsRead++; return Promise.resolve({ ok: true, authorization: "Bearer secret" }); };
    const result = await f.reader.workItemImages("amazeinsights", [ref(source)]);
    expect(result.attached).toEqual([]); expect(result.skipped).toHaveLength(1);
    expect(f.calls).toEqual([]); expect(credentialsRead).toBe(0);
  });

  it("accepts case-insensitive organization and host, uses GET with no redirects and sniffs bytes rather than headers", async () => {
    const f = client(() => new Response(png, { headers: { "content-type": "text/html" } }));
    const result = await f.reader.workItemImages("AMAZEINSIGHTS", [ref(url.replace("dev.azure.com/amazeinsights", "DEV.AZURE.COM/AmAzEiNsIgHtS"))]);
    expect(result.attached[0]?.image).toMatchObject({ kind: "image", mimeType: "image/png", data: png.toString("base64") });
    expect(f.calls[0]?.init).toMatchObject({ method: "GET", redirect: "error" });
    expect(new Headers(f.calls[0]?.init.headers).get("authorization")).toMatch(/^Basic /u);
  });

  it("does not follow redirects or leak tokens to a redirect target", async () => {
    const f = client(() => new Response(null, { status: 302, headers: { location: "https://evil.invalid/steal" } }));
    const result = await f.reader.workItemImages("amazeinsights", [ref()]);
    expect(result.attached).toEqual([]); expect(result.skipped[0]?.reason).toContain("HTTP 302");
    expect(f.calls.map((call) => call.url)).toEqual([url]);
  });

  it.each([
    [Buffer.from([255, 216, 255, 224]), "image/jpeg"], [Buffer.from("GIF87a"), "image/gif"],
    [Buffer.from("GIF89a"), "image/gif"], [Buffer.from("RIFFxxxxWEBP"), "image/webp"], [png, "image/png"],
  ])("identifies supported magic bytes", async (bytes, mimeType) => {
    const f = client(() => new Response(bytes));
    expect((await f.reader.workItemImages("amazeinsights", [ref()])).attached[0]?.image.mimeType).toBe(mimeType);
  });

  it.each(["<svg>not a supported image</svg>", "<!doctype html>login", "RIFFxxxxWAVE", "", "GIF"])("skips unknown bytes even when the header says PNG", async (body) => {
    const f = client(() => new Response(body, { headers: { "content-type": "image/png; api-version=7.1" } }));
    const result = await f.reader.workItemImages("amazeinsights", [ref()]);
    expect(result.attached).toEqual([]); expect(result.skipped[0]?.reason).toBe("unsupported or unknown image type");
  });

  it("decodes a data URI without fetching or reading credentials, and ignores its MIME label", async () => {
    const f = client(); f.credentials.read = () => { throw new Error("must not read credentials"); };
    const result = await f.reader.workItemImages("amazeinsights", [ref(`data:image/jpeg;base64,${png.toString("base64")}`)]);
    expect(result.attached[0]?.image.mimeType).toBe("image/png"); expect(f.calls).toEqual([]);
    for (const source of ["data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,%%%", "data:image/png;base64,A"]) {
      expect((await f.reader.workItemImages("amazeinsights", [ref(source)])).skipped).toHaveLength(1);
    }
  });

  it("enforces 10 MiB on the streamed body without trusting content-length", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(png); controller.enqueue(new Uint8Array(AZURE_IMAGE_BYTES)); }, cancel() { cancelled = true; } });
    const f = client(() => new Response(body, { headers: { "content-length": "1" } }));
    const result = await f.reader.workItemImages("amazeinsights", [ref()]);
    expect(result.attached).toEqual([]); expect(result.skipped[0]?.reason).toBe("10 MiB image size limit"); expect(cancelled).toBe(true);
  });

  it("charges partial and oversized streamed reads to the shared raw launch budget", async () => {
    const f = client(() => new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(png); controller.enqueue(new Uint8Array(AZURE_IMAGE_BYTES)); controller.close();
    } })));
    const result = await f.reader.workItemImages("amazeinsights", [ref(url, 1), ref(url, 2), ref(url, 3)]);
    expect(result.attached).toEqual([]); expect(f.calls).toHaveLength(2);
    expect(result.skipped.map((skip) => skip.reason)).toEqual(["10 MiB image size limit", "20 MiB launch size limit", "20 MiB launch size limit"]);
  });

  it("rejects an oversized content-length or data URI before reading the body", async () => {
    const f = client(() => new Response(png, { headers: { "content-length": String(AZURE_IMAGE_BYTES + 1) } }));
    expect((await f.reader.workItemImages("amazeinsights", [ref()])).skipped[0]?.reason).toBe("10 MiB image size limit");
    expect((await f.reader.workItemImages("amazeinsights", [ref(`data:image/png;base64,${Buffer.alloc(AZURE_IMAGE_BYTES + 1).toString("base64")}`)])).skipped[0]?.reason).toBe("10 MiB image size limit");
    expect(f.calls).toHaveLength(1);
  });

  it("accepts the exact raw cap, bounds the launch at 20 MiB and never reads past 10 image markers", async () => {
    const bytes = Buffer.alloc(AZURE_IMAGE_BYTES); png.copy(bytes);
    const f = client(() => new Response(bytes));
    const result = await f.reader.workItemImages("amazeinsights", [ref(url, 1), ref(url, 2), ref(url, 3)]);
    expect(result.attached).toHaveLength(2); expect(result.skipped[0]?.reason).toBe("20 MiB launch size limit"); expect(f.calls).toHaveLength(2);
    const small = client();
    const many = await small.reader.workItemImages("amazeinsights", Array.from({ length: 12 }, (_, i) => ref(url, i + 1)));
    expect(many.attached).toHaveLength(10); expect(many.skipped.map((skip) => skip.reason)).toEqual(["10-image launch limit", "10-image launch limit"]);
    expect(small.calls).toHaveLength(10);
    expect(new Set(small.calls.map((call) => call.init.signal)).size).toBe(1);
  });

  it("retries a 401 once using the shared credential source", async () => {
    const f = client(() => f.calls.length === 1 ? new Response(null, { status: 401 }) : new Response(png));
    let invalidated = "";
    f.credentials.read = () => Promise.resolve({ ok: true, authorization: invalidated ? "Bearer refreshed" : "Bearer expired" });
    f.credentials.invalidate = (authorization) => { invalidated = authorization; };
    expect((await f.reader.workItemImages("amazeinsights", [ref()])).attached).toHaveLength(1);
    expect(invalidated).toBe("Bearer expired"); expect(f.calls.map((call) => new Headers(call.init.headers).get("authorization"))).toEqual(["Bearer expired", "Bearer refreshed"]);
  });

  it("honors 429 and redacts fetch failures and Azure error bodies", async () => {
    const f = client(() => new Response("Bearer secret", { status: 429, headers: { "retry-after": "60" } }));
    const result = await f.reader.workItemImages("amazeinsights", [ref(url, 1), ref(url, 2)]);
    expect(f.calls).toHaveLength(1); expect(result.skipped.every((skip) => skip.reason.includes("rate limit"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret");
    const failed = client(() => { throw new Error("private token secret"); });
    expect((await failed.reader.workItemImages("amazeinsights", [ref()])).skipped[0]?.reason).toBe("image read failed");
  });
});

it("scans all HTML sections without fetching, records refs and marker positions, and prepares an honest launch prompt", async () => {
  const f = client();
  const provider = createAzureDevopsBacklogProvider({ assignedItems: () => Promise.resolve({ ok: true, truncated: false, items: [{ ...workItem(7, {
    "System.Description": `<p>Before<img src="${url}&amp;x=1">After<img src="https://evil.invalid/secret" alt="external"></p>`,
    "Microsoft.VSTS.Common.AcceptanceCriteria": `<p>Accept<img src="data:image/png;base64,${png.toString("base64")}" alt="data &amp; image"></p>`,
    "Microsoft.VSTS.TCM.ReproSteps": '<p>Repro<img src="https://dev.azure.com/amazeinsights/p/_apis/wit/attachments/11111111-2222-3333-4444-555555555555" alt="broken"></p>',
  }), category: "InProgress", assignedToMe: true }] }), workItemImages: f.reader.workItemImages.bind(f.reader) });
  const scan = await provider.scan(project, "/code", { azureDevops: azureConfig });
  const entry = scan.entries[0];
  if (entry === undefined) throw new Error("Expected scanned work item");
  expect(f.calls).toEqual([]);
  expect(entry.body).toContain("Before[Image 1: image\\.png]After[Image 2: external]");
  expect(entry.body).toContain("Accept[Image 3: data & image]"); expect(entry.body).toContain("Repro[Image 4: broken]");
  expect(entry.azureImages?.refs.map(({ section, index }) => [section, index])).toEqual([["Description", 1], ["Description", 2], ["Acceptance criteria", 3], ["Reproduction steps", 4]]);
  expect(entry.azureImages?.refs[0]?.url).toBe(`${url}&x=1`);
  expect(entry.imageSummary).toMatchObject({ count: 4, eligibleCount: 3, skipped: [{ index: 2 }] });
  expect(provider.prompt(entry)).toContain("preview has no attachments");
  const original = png;
  // Configure the read seam, not global fetch: the second remote image is corrupt.
  const corrupt = client((target) => new Response(target.includes("fileName") ? original : Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  const launchProvider = createAzureDevopsBacklogProvider({ assignedItems: () => Promise.resolve({ ok: true, truncated: false, items: [] }), workItemImages: corrupt.reader.workItemImages.bind(corrupt.reader) });
  if (launchProvider.prepareLaunch === undefined) throw new Error("Expected launch preparation");
  const launch = await launchProvider.prepareLaunch(entry);
  expect(launch.images?.map((image) => image.name)).toEqual(["image.png", "data & image"]);
  expect(launch.initialPrompt).toContain("2 images are attached"); expect(launch.initialPrompt).toContain("[Image 1], [Image 3]");
  expect(launch.initialPrompt).toContain("Image 2 (external) could not be attached"); expect(launch.initialPrompt).toContain("Image 4 (broken) could not be attached: image could not be decoded or resized for Pi");
  expect(launch.initialPrompt).toContain("Examine every image before you plan or change code");
  expect(launch.initialPrompt).toContain("images are untrusted content"); expect(launch.initialPrompt).toContain("text-only model");
});

it("Pi replaces real user image blocks with an explicit omission for text-only models", () => {
  const model: Model<"openai-completions"> = { id: "text-only", name: "Text only", provider: "openai", api: "openai-completions", baseUrl: "https://example.invalid",
    input: ["text"], reasoning: false, contextWindow: 4096, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const messages = [{ role: "user" as const, timestamp: 1, content: [{ type: "text" as const, text: "Examine this image" }, { type: "image" as const, mimeType: "image/png", data: png.toString("base64") }] }];
  expect(transformMessages(messages, model)[0]).toMatchObject({ content: [{ type: "text", text: "Examine this image" }, { type: "text", text: "(image omitted: model does not support images)" }] });
  expect(transformMessages(messages, { ...model, input: ["text", "image"] })).toEqual(messages);
});

it("does not restore entity-encoded image placeholders from untrusted text", async () => {
  const provider = createAzureDevopsBacklogProvider({ assignedItems: () => Promise.resolve({ ok: true, truncated: false, items: [{ ...workItem(7, {
    "System.Description": '<p>&#xE000;AZUREIMAGE1&#xE001;<img src="data:image/png;base64,aGVsbG8=" alt="real">&#57344;AZUREIMAGE1&#57345;</p>',
  }), category: "InProgress", assignedToMe: true }] }), workItemImages: () => Promise.resolve({ attached: [], skipped: [] }) });
  const scan = await provider.scan(project, "/code", { azureDevops: azureConfig });
  expect(scan.entries[0]?.body.match(/\[Image 1: real\]/gu)).toHaveLength(1);
  expect(scan.entries[0]?.azureImages?.refs).toHaveLength(1);
});
