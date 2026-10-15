import { openBrowserFile, type BrowserFileAccess } from "../browserFileAccess.js";

export class PromptResourceContentLimitError extends Error {}

export async function readBoundedPromptResourceFile(filePath: string, maxBytes: number, signal?: AbortSignal, browserFiles?: BrowserFileAccess): Promise<string> {
  throwIfAborted(signal);
  const handle = await openBrowserFile(filePath, browserFiles);
  try {
    const file = await handle.stat();
    if (!file.isFile() || file.size > maxBytes) throw new PromptResourceContentLimitError();
    const capacity = Math.min(maxBytes + 1, file.size + 1);
    const content = Buffer.alloc(Math.max(1, capacity));
    let offset = 0;
    while (offset < content.length) {
      throwIfAborted(signal);
      const { bytesRead } = await handle.read(content, offset, content.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maxBytes || offset > file.size) throw new PromptResourceContentLimitError();
    return content.subarray(0, offset).toString("utf8");
  } finally {
    await handle.close();
  }
}

export function assertBoundedPromptResourceContent(content: string, maxBytes: number): void {
  if (Buffer.byteLength(content, "utf8") > maxBytes) throw new PromptResourceContentLimitError();
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new Error("Prompt-resource loading aborted.");
}
