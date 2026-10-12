import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseDurableSessionAddress, type DurableSessionAddress } from "./durableSessionAddress.js";

/** A discovery pointer only. The family's binding document selects the current conversation. */
export async function readDurableSessionLocator(directory: string): Promise<DurableSessionAddress | undefined> {
  let text: string;
  try { text = await readFile(join(directory, "locator.json"), "utf8"); }
  catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  return parseDurableSessionAddress(JSON.parse(text));
}

export async function writeDurableSessionLocator(directory: string, address: DurableSessionAddress): Promise<void> {
  const file = join(directory, "locator.json");
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(parseDurableSessionAddress(address)) + "\n", { mode: 0o600 });
  await rename(temporary, file);
}
